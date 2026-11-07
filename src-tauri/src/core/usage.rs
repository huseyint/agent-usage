use super::types::*;
use serde_json::Value;

fn incompatible() -> AppError {
    AppError::new(
        "ENGINE_INCOMPATIBLE",
        "ccusage returned an unsupported JSON schema. Use the bundled engine or version 20.0.48.",
    )
}
fn number(v: &Value, key: &str) -> Result<u64> {
    v.get(key).and_then(Value::as_u64).ok_or_else(incompatible)
}
pub fn micros(v: &Value) -> Result<i64> {
    let f = v.as_f64().ok_or_else(incompatible)?;
    if !f.is_finite() || !(0.0..=1_000_000_000.0).contains(&f) {
        return Err(incompatible());
    }
    Ok((f * 1_000_000.0).round() as i64)
}
fn tokens(v: &Value) -> Result<Tokens> {
    Ok(Tokens {
        input: number(v, "inputTokens")?,
        output: number(v, "outputTokens")?,
        cache_read: number(v, "cacheReadTokens")?,
        cache_creation: number(v, "cacheCreationTokens")?,
        total: number(v, "totalTokens")?,
    })
}
fn models(v: &Value) -> Result<Vec<ModelUsage>> {
    v.get("modelBreakdowns")
        .and_then(Value::as_array)
        .ok_or_else(incompatible)?
        .iter()
        .map(|m| {
            Ok(ModelUsage {
                model: m
                    .get("modelName")
                    .or_else(|| m.get("model"))
                    .and_then(Value::as_str)
                    .ok_or_else(incompatible)?
                    .into(),
                tokens: Tokens {
                    input: number(m, "inputTokens")?,
                    output: number(m, "outputTokens")?,
                    cache_read: number(m, "cacheReadTokens")?,
                    cache_creation: number(m, "cacheCreationTokens")?,
                    total: m.get("totalTokens").and_then(Value::as_u64).unwrap_or(0),
                },
                cost_micros: micros(
                    m.get("cost")
                        .or_else(|| m.get("totalCost"))
                        .ok_or_else(incompatible)?,
                )?,
                period_cost_micros: None,
                lifetime_cost_micros: None,
                missing_pricing: m
                    .get("missingPricing")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                stored_cost_micros: m
                    .get("storedCost")
                    .filter(|v| !v.is_null())
                    .map(micros)
                    .transpose()?,
                is_fallback: m
                    .get("isFallback")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}
pub fn parse(json: &[u8]) -> Result<(Vec<Session>, Vec<DailyUsage>)> {
    let root: Value = serde_json::from_slice(json).map_err(|_| incompatible())?;
    let days = root
        .get("daily")
        .and_then(Value::as_array)
        .ok_or_else(incompatible)?;
    let sessions = root
        .get("session")
        .and_then(Value::as_array)
        .ok_or_else(incompatible)?;
    let expected = tokens(root.get("totals").ok_or_else(incompatible)?)?;
    let expected_cost = micros(&root["totals"]["totalCost"])?;
    let mut raw_total = 0u64;
    let mut raw_cost = 0i64;
    for day in days {
        raw_total = raw_total
            .checked_add(number(day, "totalTokens")?)
            .ok_or_else(incompatible)?;
        raw_cost = raw_cost
            .checked_add(micros(&day["totalCost"])?)
            .ok_or_else(incompatible)?;
    }
    if raw_total != expected.total || (raw_cost - expected_cost).abs() > days.len() as i64 + 1 {
        return Err(AppError::new("ENGINE_RECONCILIATION","ccusage daily rows did not reconcile with its report totals. Previous data has been kept."));
    }
    let unpriced: Vec<_> = root["totals"]["unpricedModels"]
        .as_array()
        .map(|v| v.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut daily = vec![];
    for day in days {
        let date = day
            .get("period")
            .and_then(Value::as_str)
            .ok_or_else(incompatible)?;
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| incompatible())?;
        let agents = day
            .get("agents")
            .and_then(Value::as_array)
            .ok_or_else(incompatible)?;
        for row in agents {
            let provider = row
                .get("agent")
                .and_then(Value::as_str)
                .ok_or_else(incompatible)?;
            if !["claude", "codex"].contains(&provider) {
                continue;
            }
            let mut model = models(row)?;
            for m in &mut model {
                m.missing_pricing |= unpriced.contains(&m.model.as_str());
            }
            daily.push(DailyUsage {
                date: date.into(),
                provider: provider.into(),
                tokens: tokens(row)?,
                cost_micros: micros(&row["totalCost"])?,
                missing_pricing: model.iter().any(|m| m.missing_pricing),
                models: model,
            });
        }
    }
    let mut output = vec![];
    for row in sessions {
        let provider = row
            .get("agent")
            .and_then(Value::as_str)
            .ok_or_else(incompatible)?;
        if !["claude", "codex"].contains(&provider) {
            continue;
        }
        let id = row
            .get("period")
            .and_then(Value::as_str)
            .ok_or_else(incompatible)?
            .to_string();
        let last = row
            .pointer("/metadata/lastActivity")
            .and_then(Value::as_str)
            .ok_or_else(incompatible)?;
        chrono::DateTime::parse_from_rfc3339(last).map_err(|_| incompatible())?;
        let mut model = models(row)?;
        for m in &mut model {
            m.missing_pricing |= unpriced.contains(&m.model.as_str());
        }
        output.push(Session {
            id,
            provider: provider.into(),
            last_activity: last.into(),
            first_activity: String::new(),
            tokens: tokens(row)?,
            cost_micros: micros(&row["totalCost"])?,
            daily_usage: row
                .pointer("/metadata/dailyUsage")
                .map(|value| {
                    value
                        .as_array()
                        .ok_or_else(incompatible)?
                        .iter()
                        .map(|day| {
                            let date = day["period"].as_str().ok_or_else(incompatible)?;
                            chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                                .map_err(|_| incompatible())?;
                            let mut models = models(day)?;
                            for model in &mut models {
                                model.missing_pricing |= unpriced.contains(&model.model.as_str());
                            }
                            Ok(DailyUsage {
                                date: date.into(),
                                provider: provider.into(),
                                tokens: tokens(day)?,
                                cost_micros: micros(&day["totalCost"])?,
                                missing_pricing: models.iter().any(|m| m.missing_pricing),
                                models,
                            })
                        })
                        .collect::<Result<Vec<_>>>()
                })
                .transpose()?,
            missing_pricing: model.iter().any(|m| m.missing_pricing),
            models: model,
            project_path: row
                .pointer("/metadata/projectPath")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
            ..Session::default()
        });
    }
    Ok((output, daily))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_engine_fixture() {
        let (s, d) = parse(include_bytes!("../../../tests/fixtures/unified.json")).unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!(d.len(), 3);
        assert_eq!(
            s.iter()
                .find(|s| s.provider == "codex")
                .unwrap()
                .tokens
                .total,
            150
        );
        assert_eq!(
            d.iter().map(|d| d.tokens.total).sum::<u64>(),
            s.iter().map(|s| s.tokens.total).sum::<u64>()
        );
    }
    #[test]
    fn rejects_schema_and_negative_money() {
        assert!(parse(b"{}").is_err());
        assert!(micros(&serde_json::json!(-1)).is_err());
        assert_eq!(micros(&serde_json::json!(0.0000014)).unwrap(), 1);
    }
    #[test]
    fn preserves_total_and_missing_pricing() {
        let mut v: Value =
            serde_json::from_slice(include_bytes!("../../../tests/fixtures/unified.json")).unwrap();
        v["session"][0]["totalTokens"] = 12345.into();
        v["session"][0]["modelBreakdowns"][0]["missingPricing"] = true.into();
        let (s, _) = parse(&serde_json::to_vec(&v).unwrap()).unwrap();
        assert_eq!(s[0].tokens.total, 12345);
        assert!(s[0].missing_pricing);
    }
}
