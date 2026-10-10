//! Preserve advertised configuration identities, including model-dependent effort options.
use super::model::{AcpSessionModelOptions, SessionConfigKind, SessionConfigOption};
use super::{AcpError, AcpSessionOption};
use serde_json::Value;

fn values(raw: &Value) -> Vec<AcpSessionOption> {
    raw.as_array()
        .into_iter()
        .flatten()
        .flat_map(|item| {
            if let Some(group) = item.get("options") {
                return values(group);
            }
            let Some(value) = item.get("value").and_then(Value::as_str) else {
                return vec![];
            };
            vec![AcpSessionOption {
                value: value.to_string(),
                name: item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(value)
                    .to_string(),
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            }]
        })
        .collect()
}

pub(crate) fn is_effort(option: &SessionConfigOption) -> bool {
    option.category.as_deref() == Some("thought_level")
        || [
            "reasoning_effort",
            "effort",
            "thinking",
            "thinking_level",
            "thought_level",
        ]
        .contains(&option.id.as_str())
}

pub(crate) fn model_config_id(options: &AcpSessionModelOptions) -> &str {
    options
        .extra_options
        .iter()
        .find(|option| option.category.as_deref() == Some("model") || option.id == "model")
        .map(|option| option.id.as_str())
        .unwrap_or("model")
}

pub(crate) fn effort_config_id<'a>(
    options: &'a AcpSessionModelOptions,
    value: &str,
) -> Option<&'a str> {
    options.extra_options.iter().find(|option| is_effort(option) && matches!(&option.kind,
        SessionConfigKind::Select { options, .. } if options.iter().any(|entry| entry.value == value)))
        .map(|option| option.id.as_str())
}

/// The engine also returns raw configOptions: its compatibility projection loses category.
pub(crate) fn response_options(response: &Value) -> Result<AcpSessionModelOptions, AcpError> {
    let raw = response.get("configOptions").or_else(|| {
        response.get("result").and_then(|result| {
            result
                .get("configOptions")
                .or_else(|| result.as_array().map(|_| result))
        })
    });
    let Some(raw) = raw.filter(|raw| raw.is_array()) else {
        return super::service::convert_engine_model_options(
            response.get("modelOptions").unwrap_or(&Value::Null),
        );
    };
    let mut result = AcpSessionModelOptions::default();
    for item in raw.as_array().into_iter().flatten() {
        let Some(id) = item
            .get("id")
            .or_else(|| item.get("configId"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let category = item
            .get("category")
            .and_then(Value::as_str)
            .map(str::to_string);
        let current = item.get("currentValue").or_else(|| item.get("current"));
        let entries = values(item.get("options").unwrap_or(&Value::Null));
        let kind = if item.get("type").and_then(Value::as_str) == Some("boolean") {
            SessionConfigKind::Boolean {
                current: current.and_then(Value::as_bool).unwrap_or(false),
            }
        } else if item.get("type").and_then(Value::as_str) == Some("select")
            || item.get("options").is_some()
        {
            SessionConfigKind::Select {
                options: entries
                    .iter()
                    .map(|entry| super::model::SessionConfigValue {
                        value: entry.value.clone(),
                        name: entry.name.clone(),
                        description: entry.description.clone(),
                    })
                    .collect(),
                current: current.and_then(Value::as_str).map(str::to_string),
            }
        } else {
            SessionConfigKind::Unsupported
        };
        let option = SessionConfigOption {
            id: id.to_string(),
            name: item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_string(),
            description: item
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string),
            category,
            kind,
        };
        if option.category.as_deref() == Some("model") || id == "model" {
            result.models = entries.clone();
            result.current_model_id = current.and_then(Value::as_str).map(str::to_string);
        } else if is_effort(&option) {
            result.reasoning_efforts = entries;
            result.current_reasoning_effort = current.and_then(Value::as_str).map(str::to_string);
        }
        result.extra_options.push(option);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn raw_config_category_identity_groups_and_empty_effort_are_preserved() {
        let options = response_options(&json!({ "configOptions": [
            { "id": "model-choice", "category": "model", "type": "select", "currentValue": "m", "options": [{ "group": "provider", "options": [{ "value": "m", "name": "Model" }] }] },
            { "id": "budget-choice", "category": "thought_level", "type": "select", "currentValue": "medium", "options": [{ "value": "medium", "name": "Medium" }] },
            { "id": "fast", "type": "boolean", "currentValue": true },
            { "name": "missing identity" }
        ], "modelOptions": { "models": [], "current_reasoning_effort": "stale" } })).expect("raw options");
        assert_eq!(model_config_id(&options), "model-choice");
        assert_eq!(options.models[0].value, "m");
        assert_eq!(options.current_reasoning_effort.as_deref(), Some("medium"));
        assert_eq!(effort_config_id(&options, "medium"), Some("budget-choice"));
        assert_eq!(effort_config_id(&options, "high"), None);
        let empty = response_options(&json!({ "result": { "configOptions": [] }, "modelOptions": { "current_reasoning_effort": "stale" } })).expect("empty config");
        assert!(empty.reasoning_efforts.is_empty());
        assert!(empty.current_reasoning_effort.is_none());
    }
}
