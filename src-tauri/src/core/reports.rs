use super::{
    metadata::{first_usage_date, local_day, session_activity_days},
    types::*,
};
use chrono::{Datelike, Duration, NaiveDate};
use std::collections::{BTreeMap, BTreeSet, HashMap};

fn day_matches(day: &str, q: &Query) -> bool {
    q.since.as_ref().is_none_or(|s| day >= s.as_str())
        && q.until.as_ref().is_none_or(|u| day <= u.as_str())
}
fn provider_matches(provider: &str, q: &Query) -> bool {
    q.providers.is_empty() || q.providers.iter().any(|s| s == provider)
}
pub fn validate(q: &Query) -> Result<()> {
    for date in [&q.since, &q.until].into_iter().flatten() {
        NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| AppError::new("INVALID_QUERY", "Dates must be valid calendar dates."))?;
    }
    if let (Some(s), Some(u)) = (&q.since, &q.until) {
        if s > u {
            return Err(AppError::new(
                "INVALID_QUERY",
                "Start date must be before the end date.",
            ));
        }
    }
    Ok(())
}
fn in_period(s: &Session, q: &Query, tz: &str) -> bool {
    if !provider_matches(&s.provider, q) {
        return false;
    }
    let days = session_activity_days(s);
    if !days.is_empty() {
        days.iter().any(|d| day_matches(d, q))
    } else {
        local_day(&s.last_activity, tz).is_some_and(|d| day_matches(&d, q))
    }
}
pub fn period_cost(s: &Session, q: &Query) -> Option<i64> {
    if let Some(days) = &s.daily_usage {
        return Some(
            days.iter()
                .filter(|d| day_matches(&d.date, q))
                .map(|d| d.cost_micros)
                .sum(),
        );
    }
    // Legacy/external snapshots can safely reuse lifetime only when the entire
    // session is covered. Never distribute costs proportionally across days.
    if (q.since.is_none() && q.until.is_none())
        || (!s.activity_days.is_empty() && s.activity_days.iter().all(|d| day_matches(d, q)))
    {
        Some(s.cost_micros)
    } else if !s.activity_days.is_empty() && !s.activity_days.iter().any(|d| day_matches(d, q)) {
        Some(0)
    } else {
        None
    }
}
pub fn session_matches(s: &Session, q: &Query, tz: &str) -> bool {
    let haystack = format!("{} {} {} {}", s.title, s.id, s.project, s.project_path).to_lowercase();
    in_period(s, q, tz)
        && haystack.contains(&q.search.to_lowercase())
        && (q.projects.is_empty() || q.projects.contains(&s.project_path))
        && (q.models.is_empty() || s.models.iter().any(|m| q.models.contains(&m.model)))
        && (!q.favorite || s.favorite)
        && (q.tag.is_empty() || s.tags.iter().any(|t| t.eq_ignore_ascii_case(&q.tag)))
        && (q.provenance.is_empty() || q.provenance == s.title_provenance)
        && (q.source_id.is_empty() || q.source_id == s.source_id)
        && q.min_cost
            .is_none_or(|v| period_cost(s, q).is_some_and(|cost| cost as f64 >= v * 1e6))
        && q.max_cost
            .is_none_or(|v| period_cost(s, q).is_some_and(|cost| cost as f64 <= v * 1e6))
        && q.min_tokens.is_none_or(|v| s.tokens.total >= v)
        && q.max_tokens.is_none_or(|v| s.tokens.total <= v)
}
fn totals(days: &[DailyUsage], sessions: &[Session], q: &Query, tz: &str) -> Summary {
    let mut s = Summary::default();
    let mut dates = BTreeSet::new();
    for d in days
        .iter()
        .filter(|d| provider_matches(&d.provider, q) && day_matches(&d.date, q))
    {
        s.tokens.add(&d.tokens);
        s.cost_micros += d.cost_micros;
        s.missing_pricing |= d.missing_pricing;
        if d.tokens.total > 0 || d.cost_micros > 0 {
            dates.insert(&d.date);
        }
    }
    s.active_days = dates.len();
    let active: Vec<_> = sessions.iter().filter(|s| in_period(s, q, tz)).collect();
    s.sessions = active.len();
    s.lifetime_cost_micros = active.iter().map(|s| s.cost_micros).sum();
    s.projects = active
        .iter()
        .map(|s| &s.project_path)
        .collect::<BTreeSet<_>>()
        .len();
    s
}
pub fn group_key(s: &Session, q: &Query, tz: &str) -> String {
    let day = local_day(&s.last_activity, tz).unwrap_or_default();
    match q.group_by.as_str() {
        "project" => s.project_path.clone(),
        "provider" => s.provider.clone(),
        "none" => "All sessions".into(),
        "month" => day.get(..7).unwrap_or_default().into(),
        "week" => NaiveDate::parse_from_str(&day, "%Y-%m-%d")
            .ok()
            .map(|d| {
                let n = if q.week_start == "sunday" {
                    d.weekday().num_days_from_sunday()
                } else {
                    d.weekday().num_days_from_monday()
                };
                (d - Duration::days(n as i64)).to_string()
            })
            .unwrap_or_default(),
        _ => day,
    }
}
pub fn build(
    mut snapshot: Snapshot,
    q: &Query,
    annotations: &HashMap<String, Annotation>,
    aliases: &HashMap<String, String>,
    stale: bool,
) -> Result<ViewData> {
    validate(q)?;
    for s in &mut snapshot.sessions {
        if let Some(a) = annotations.get(&s.key) {
            s.favorite = a.favorite;
            s.tags = a.tags.clone();
            if let Some(title) = a.title.as_ref().filter(|s| !s.is_empty()) {
                s.title = title.clone();
                s.title_provenance = "local".into();
            }
        }
        if let Some(alias) = aliases.get(&s.project_path).filter(|s| !s.is_empty()) {
            s.project = alias.clone();
        }
    }
    let summary = totals(&snapshot.daily, &snapshot.sessions, q, &snapshot.timezone);
    let mut provider_lifetime_costs = BTreeMap::<String, i64>::new();
    for s in snapshot
        .sessions
        .iter()
        .filter(|s| in_period(s, q, &snapshot.timezone))
    {
        *provider_lifetime_costs
            .entry(s.provider.clone())
            .or_default() += s.cost_micros;
    }
    let previous = if let (Some(since), Some(until)) = (&q.since, &q.until) {
        let s = NaiveDate::parse_from_str(since, "%Y-%m-%d").unwrap();
        let u = NaiveDate::parse_from_str(until, "%Y-%m-%d").unwrap();
        let len = (u - s).num_days() + 1;
        let ps = s - Duration::days(len);
        let pu = s - Duration::days(1);
        if snapshot.daily.iter().any(|d| d.date <= ps.to_string()) {
            let mut pq = q.clone();
            pq.since = Some(ps.to_string());
            pq.until = Some(pu.to_string());
            Some(totals(
                &snapshot.daily,
                &snapshot.sessions,
                &pq,
                &snapshot.timezone,
            ))
        } else {
            None
        }
    } else {
        None
    };
    let available_projects = snapshot
        .sessions
        .iter()
        .map(|s| (s.project_path.clone(), s.project.clone()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let available_models = snapshot
        .daily
        .iter()
        .flat_map(|s| s.models.iter().map(|m| m.model.clone()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let daily: Vec<_> = snapshot
        .daily
        .into_iter()
        .filter(|d| provider_matches(&d.provider, q) && day_matches(&d.date, q))
        .collect();
    let mut model_map: BTreeMap<String, ModelUsage> = BTreeMap::new();
    for m in daily.iter().flat_map(|d| &d.models) {
        let row = model_map
            .entry(m.model.clone())
            .or_insert_with(|| ModelUsage {
                model: m.model.clone(),
                ..ModelUsage::default()
            });
        row.tokens.add(&m.tokens);
        row.cost_micros += m.cost_micros;
        row.missing_pricing |= m.missing_pricing;
        row.is_fallback |= m.is_fallback;
    }
    let mut models: Vec<_> = model_map.into_values().collect();
    models.sort_by_key(|m| std::cmp::Reverse(m.cost_micros));
    let mut sessions: Vec<_> = snapshot
        .sessions
        .into_iter()
        .filter(|s| session_matches(s, q, &snapshot.timezone))
        .collect();
    for s in &mut sessions {
        s.period_cost_micros = period_cost(s, q);
        for m in &mut s.models {
            m.period_cost_micros = s
                .daily_usage
                .as_ref()
                .map(|days| {
                    days.iter()
                        .filter(|d| day_matches(&d.date, q))
                        .flat_map(|d| &d.models)
                        .filter(|usage| usage.model == m.model)
                        .map(|usage| usage.cost_micros)
                        .sum()
                })
                .or(s
                    .period_cost_micros
                    .filter(|cost| *cost == s.cost_micros)
                    .map(|_| m.cost_micros));
        }
    }
    for usage in sessions.iter().flat_map(|s| &s.models) {
        if !models.iter().any(|m| m.model == usage.model) {
            models.push(ModelUsage {
                model: usage.model.clone(),
                ..Default::default()
            });
        }
    }
    for m in &mut models {
        m.lifetime_cost_micros = Some(
            sessions
                .iter()
                .flat_map(|s| &s.models)
                .filter(|usage| usage.model == m.model)
                .map(|usage| usage.cost_micros)
                .sum(),
        );
    }
    let mut project_map: BTreeMap<String, ProjectSummary> = BTreeMap::new();
    let mut pm: BTreeMap<String, BTreeMap<String, i64>> = BTreeMap::new();
    for s in &sessions {
        let row = project_map
            .entry(s.project_path.clone())
            .or_insert_with(|| ProjectSummary {
                key: s.project_path.clone(),
                name: s.project.clone(),
                period_cost_micros: Some(0),
                ..ProjectSummary::default()
            });
        row.sessions += 1;
        row.cost_micros += s.cost_micros;
        row.period_cost_micros = row
            .period_cost_micros
            .zip(s.period_cost_micros)
            .map(|(a, b)| a + b);
        row.tokens.add(&s.tokens);
        row.last_activity = row.last_activity.clone().max(s.last_activity.clone());
        if s.provider == "claude" {
            row.claude_micros += s.period_cost_micros.unwrap_or_default();
        } else {
            row.codex_micros += s.period_cost_micros.unwrap_or_default();
        }
        for m in &s.models {
            *pm.entry(s.project_path.clone())
                .or_default()
                .entry(m.model.clone())
                .or_default() += m.period_cost_micros.unwrap_or_default();
        }
    }
    let mut projects: Vec<_> = project_map
        .into_values()
        .map(|mut p| {
            p.top_model = pm
                .get(&p.key)
                .and_then(|m| m.iter().max_by_key(|(_, c)| *c).map(|(m, _)| m.clone()))
                .unwrap_or_default();
            p
        })
        .collect();
    projects.sort_by_key(|p| std::cmp::Reverse(p.period_cost_micros));
    let mut group_totals = BTreeMap::new();
    let mut group_period_totals = BTreeMap::new();
    for s in &sessions {
        let entry = group_totals
            .entry(group_key(s, q, &snapshot.timezone))
            .or_insert((0usize, 0i64));
        entry.0 += 1;
        entry.1 += s.cost_micros;
        let period = group_period_totals
            .entry(group_key(s, q, &snapshot.timezone))
            .or_insert(Some(0));
        *period = period.zip(s.period_cost_micros).map(|(a, b)| a + b);
    }
    let descending_groups =
        if q.sort == "last" && matches!(q.group_by.as_str(), "day" | "week" | "month") {
            q.descending
        } else {
            q.descending_groups
        };
    sessions.sort_by(|a, b| {
        let group_order =
            group_key(a, q, &snapshot.timezone).cmp(&group_key(b, q, &snapshot.timezone));
        if !group_order.is_eq() {
            return if descending_groups {
                group_order.reverse()
            } else {
                group_order
            };
        }

        let order = match q.sort.as_str() {
            "cost" => a.period_cost_micros.cmp(&b.period_cost_micros),
            "periodCost" => a.period_cost_micros.cmp(&b.period_cost_micros),
            "tokens" => a.tokens.total.cmp(&b.tokens.total),
            "input" => a.tokens.input.cmp(&b.tokens.input),
            "output" => a.tokens.output.cmp(&b.tokens.output),
            "cache" => a.tokens.cache_read.cmp(&b.tokens.cache_read),
            "name" => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
            "project" => a.project.cmp(&b.project),
            "provider" => a.provider.cmp(&b.provider),
            "first" => first_usage_date(a, &snapshot.timezone)
                .cmp(&first_usage_date(b, &snapshot.timezone))
                .then_with(|| a.first_activity.cmp(&b.first_activity)),
            _ => a.last_activity.cmp(&b.last_activity),
        }
        .then_with(|| a.key.cmp(&b.key));
        if q.descending {
            order.reverse()
        } else {
            order
        }
    });
    let mut top_sessions = sessions.clone();
    top_sessions.sort_by_key(|s| std::cmp::Reverse(s.period_cost_micros));
    top_sessions.truncate(5);
    let count = sessions.len();
    let page = sessions
        .into_iter()
        .skip(q.offset)
        .take(q.limit.clamp(1, 500))
        .collect();
    Ok(ViewData {
        group_totals,
        group_period_totals,
        provider_lifetime_costs,
        summary,
        previous,
        sessions: page,
        session_count: count,
        daily,
        projects,
        models,
        top_sessions,
        sources: snapshot.sources,
        scanned_at: snapshot.scanned_at,
        engine_version: snapshot.engine_version,
        timezone: snapshot.timezone,
        cost_mode: snapshot.cost_mode,
        stale,
        warnings: snapshot.warnings,
        available_projects,
        available_models,
    })
}
pub fn csv_cell(value: &str) -> String {
    let safe = if value.starts_with(['\t', '\r', '\n'])
        || value
            .trim_start()
            .starts_with(['=', '+', '-', '@', '\t', '\r'])
    {
        format!("'{value}")
    } else {
        value.to_string()
    };
    format!("\"{}\"", safe.replace('"', "\"\""))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_metadata_uses_daily_dates_for_filters_totals_and_first_sort() {
        let day = |date: &str, cost| DailyUsage {
            date: date.into(),
            provider: "codex".into(),
            cost_micros: cost,
            ..Default::default()
        };
        let spanning = Session {
            key: "spanning".into(),
            provider: "codex".into(),
            project_path: "project".into(),
            last_activity: "2026-11-10T18:00:00Z".into(),
            source_status: "metadata incomplete".into(),
            daily_usage: Some(vec![
                day("2026-11-09", 75_000),
                day("2026-11-08", 1_500_000),
            ]),
            cost_micros: 1_575_000,
            ..Default::default()
        };
        assert_eq!(
            first_usage_date(&spanning, "America/Chicago").as_deref(),
            Some("2026-11-08")
        );
        assert_eq!(session_activity_days(&spanning).len(), 2);
        let snapshot = Snapshot {
            timezone: "America/Chicago".into(),
            sessions: vec![spanning.clone()],
            daily: spanning.daily_usage.clone().unwrap(),
            ..Default::default()
        };
        for (date, cost, count) in [
            ("2026-11-08", 1_500_000, 1),
            ("2026-11-09", 75_000, 1),
            ("2026-11-10", 0, 0),
        ] {
            let view = build(
                snapshot.clone(),
                &Query {
                    since: Some(date.into()),
                    until: Some(date.into()),
                    ..Default::default()
                },
                &Default::default(),
                &Default::default(),
                false,
            )
            .unwrap();
            assert_eq!(view.session_count, count);
            assert_eq!(view.summary.sessions, count);
            assert_eq!(view.summary.cost_micros, cost);
            assert_eq!(view.projects.len(), count);
            if count > 0 {
                assert_eq!(view.sessions[0].period_cost_micros, Some(cost));
                assert_eq!(view.projects[0].period_cost_micros, Some(cost));
                assert_eq!(view.provider_lifetime_costs["codex"], 1_575_000);
            }
        }
        let view = build(
            Snapshot {
                sessions: vec![
                    Session {
                        key: "earlier".into(),
                        provider: "codex".into(),
                        first_activity: "2026-11-07T18:00:00Z".into(),
                        last_activity: "2026-11-07T19:00:00Z".into(),
                        activity_days: vec!["2026-11-07".into()],
                        ..Default::default()
                    },
                    spanning,
                ],
                ..snapshot
            },
            &Query {
                sort: "first".into(),
                group_by: "none".into(),
                descending: false,
                ..Default::default()
            },
            &Default::default(),
            &Default::default(),
            false,
        )
        .unwrap();
        assert_eq!(
            view.sessions
                .iter()
                .map(|s| s.key.as_str())
                .collect::<Vec<_>>(),
            vec!["earlier", "spanning"]
        );
    }
    #[test]
    fn period_costs_preserve_lifetime_and_full_group_totals_before_pagination() {
        let day = |date: &str, cost| DailyUsage {
            date: date.into(),
            provider: "codex".into(),
            cost_micros: cost,
            models: vec![ModelUsage {
                model: "model".into(),
                cost_micros: cost,
                ..Default::default()
            }],
            ..Default::default()
        };
        let spanning = Session {
            key: "spanning".into(),
            provider: "codex".into(),
            project_path: "project".into(),
            last_activity: "2026-11-09T02:00:00Z".into(),
            activity_days: vec!["2026-11-07".into(), "2026-11-08".into()],
            cost_micros: 5_000_000,
            daily_usage: Some(vec![
                day("2026-11-07", 2_000_000),
                day("2026-11-08", 3_000_000),
            ]),
            models: vec![ModelUsage {
                model: "model".into(),
                cost_micros: 5_000_000,
                ..Default::default()
            }],
            ..Default::default()
        };
        let snapshot = Snapshot {
            timezone: "America/Chicago".into(),
            sessions: vec![
                spanning,
                Session {
                    key: "same-day".into(),
                    id: "same-day".into(),
                    provider: "codex".into(),
                    project_path: "project".into(),
                    last_activity: "2026-11-08T16:00:00Z".into(),
                    activity_days: vec!["2026-11-08".into()],
                    cost_micros: 1_000_000,
                    daily_usage: Some(vec![day("2026-11-08", 1_000_000)]),
                    ..Default::default()
                },
            ],
            daily: vec![day("2026-11-07", 2_000_000), day("2026-11-08", 4_000_000)],
            ..Default::default()
        };
        let query = Query {
            since: Some("2026-11-08".into()),
            until: Some("2026-11-08".into()),
            limit: 1,
            ..Default::default()
        };
        let view = build(
            snapshot.clone(),
            &query,
            &HashMap::new(),
            &HashMap::new(),
            false,
        )
        .unwrap();
        assert_eq!(view.summary.cost_micros, 4_000_000);
        assert_eq!(view.summary.lifetime_cost_micros, 6_000_000);
        assert_eq!(view.provider_lifetime_costs["codex"], 6_000_000);
        assert_eq!(view.group_totals["2026-11-08"], (2, 6_000_000));
        assert_eq!(view.group_period_totals["2026-11-08"], Some(4_000_000));
        assert_eq!(view.projects[0].period_cost_micros, Some(4_000_000));
        assert_eq!(view.projects[0].codex_micros, 4_000_000);
        assert_eq!(view.sessions.len(), 1);
        assert_eq!(view.sessions[0].period_cost_micros, Some(3_000_000));
        assert_eq!(
            view.sessions[0].models[0].period_cost_micros,
            Some(3_000_000)
        );
        assert_eq!(view.models[0].lifetime_cost_micros, Some(5_000_000));
        let filtered = build(
            snapshot,
            &Query {
                search: "same-day".into(),
                ..query
            },
            &HashMap::new(),
            &HashMap::new(),
            false,
        )
        .unwrap();
        assert_eq!(filtered.group_period_totals["2026-11-08"], Some(1_000_000));
        assert_eq!(filtered.group_totals["2026-11-08"], (1, 1_000_000));
    }

    #[test]
    fn cost_filters_and_sorting_use_the_selected_period() {
        let session = |key: &str, lifetime, period| Session {
            key: key.into(),
            id: key.into(),
            provider: "codex".into(),
            activity_days: vec!["2026-11-07".into(), "2026-11-08".into()],
            last_activity: "2026-11-08T16:00:00Z".into(),
            cost_micros: lifetime,
            daily_usage: Some(vec![DailyUsage {
                date: "2026-11-08".into(),
                cost_micros: period,
                ..Default::default()
            }]),
            ..Default::default()
        };
        let query = Query {
            since: Some("2026-11-08".into()),
            until: Some("2026-11-08".into()),
            group_by: "none".into(),
            sort: "cost".into(),
            descending: true,
            ..Default::default()
        };
        let higher_period = session("higher-period", 5_000_000, 3_000_000);
        assert!(session_matches(
            &higher_period,
            &Query {
                max_cost: Some(4.0),
                ..query.clone()
            },
            "UTC"
        ));
        assert!(!session_matches(
            &higher_period,
            &Query {
                min_cost: Some(4.0),
                ..query.clone()
            },
            "UTC"
        ));
        let snapshot = Snapshot {
            timezone: "UTC".into(),
            sessions: vec![
                session("higher-lifetime", 10_000_000, 1_000_000),
                higher_period,
            ],
            ..Default::default()
        };
        for sort in ["cost", "periodCost"] {
            let view = build(
                snapshot.clone(),
                &Query {
                    sort: sort.into(),
                    ..query.clone()
                },
                &Default::default(),
                &Default::default(),
                false,
            )
            .unwrap();
            assert_eq!(view.sessions[0].key, "higher-period");
            assert_eq!(view.sessions[0].cost_micros, 5_000_000);
            assert_eq!(view.sessions[0].period_cost_micros, Some(3_000_000));
        }
    }

    #[test]
    fn legacy_cross_day_sessions_have_unknown_period_cost_until_refreshed() {
        let session = Session {
            cost_micros: 5_000_000,
            activity_days: vec!["2026-11-07".into(), "2026-11-08".into()],
            ..Default::default()
        };
        assert_eq!(
            period_cost(
                &session,
                &Query {
                    since: Some("2026-11-08".into()),
                    until: Some("2026-11-08".into()),
                    ..Default::default()
                }
            ),
            None
        );
        assert_eq!(period_cost(&session, &Query::default()), Some(5_000_000));
        assert_eq!(
            period_cost(
                &session,
                &Query {
                    since: Some("2026-11-09".into()),
                    ..Default::default()
                }
            ),
            Some(0)
        );
    }

    #[test]
    fn monday_recents_fill_from_friday_while_today_uses_only_monday_usage() {
        let friday = Snapshot {
            timezone: "America/Chicago".into(),
            scanned_at: "2026-11-06T23:00:00Z".into(),
            sessions: (10..18)
                .map(|hour| Session {
                    key: format!("friday-{hour}"),
                    provider: "codex".into(),
                    last_activity: format!("2026-11-06T{hour}:00:00Z"),
                    activity_days: vec!["2026-11-06".into()],
                    cost_micros: 50_000_000,
                    ..Default::default()
                })
                .collect(),
            daily: vec![DailyUsage {
                date: "2026-11-06".into(),
                provider: "codex".into(),
                cost_micros: 20_000_000,
                ..Default::default()
            }],
            ..Default::default()
        };
        for monday_count in [0, 2] {
            let mut snapshot = friday.clone();
            for hour in 12..12 + monday_count {
                snapshot.sessions.push(Session {
                    key: format!("monday-{hour}"),
                    provider: "codex".into(),
                    last_activity: format!("2026-11-09T{hour}:00:00Z"),
                    activity_days: vec!["2026-11-09".into()],
                    cost_micros: 100_000_000,
                    ..Default::default()
                });
            }
            if monday_count > 0 {
                snapshot.daily.push(DailyUsage {
                    date: "2026-11-09".into(),
                    provider: "codex".into(),
                    cost_micros: 7_000_000,
                    ..Default::default()
                });
            }
            let recent = build(
                snapshot.clone(),
                &Query {
                    group_by: "none".into(),
                    sort: "last".into(),
                    descending: true,
                    limit: 8,
                    ..Default::default()
                },
                &HashMap::new(),
                &HashMap::new(),
                false,
            )
            .unwrap();
            assert_eq!(recent.sessions.len(), 8);
            assert!(recent.sessions[..monday_count]
                .iter()
                .all(|s| s.key.starts_with("monday")));
            assert!(recent.sessions[monday_count..]
                .iter()
                .all(|s| s.key.starts_with("friday")));
            let today = build(
                snapshot,
                &Query {
                    since: Some("2026-11-09".into()),
                    until: Some("2026-11-09".into()),
                    ..Default::default()
                },
                &HashMap::new(),
                &HashMap::new(),
                false,
            )
            .unwrap();
            assert_eq!(today.summary.sessions, monday_count);
            assert_eq!(
                today.summary.cost_micros,
                if monday_count == 0 { 0 } else { 7_000_000 }
            );
        }
    }

    #[test]
    fn last_activity_sorts_date_groups_and_rows_before_pagination() {
        let snapshot = Snapshot {
            timezone: "America/Chicago".into(),
            sessions: [
                "2026-03-11T03:00:00Z",
                "2026-01-31T02:00:00Z",
                "2026-02-11T03:00:00Z",
                "2026-03-11T02:00:00Z",
                "2026-02-11T02:00:00Z",
                "2026-01-31T03:00:00Z",
            ]
            .into_iter()
            .map(|timestamp| Session {
                key: timestamp.into(),
                last_activity: timestamp.into(),
                ..Session::default()
            })
            .collect(),
            ..Snapshot::default()
        };
        let mut expected: Vec<_> = snapshot
            .sessions
            .iter()
            .map(|s| s.last_activity.clone())
            .collect();
        expected.sort();
        for descending in [false, true] {
            let ordered: Vec<_> = if descending {
                expected.iter().rev().cloned().collect()
            } else {
                expected.clone()
            };
            for group_by in ["day", "week", "month"] {
                for offset in [0, 2, 4] {
                    let q = Query {
                        sort: "last".into(),
                        group_by: group_by.into(),
                        descending,
                        descending_groups: !descending,
                        offset,
                        limit: 2,
                        ..Query::default()
                    };
                    let view = build(
                        snapshot.clone(),
                        &q,
                        &HashMap::new(),
                        &HashMap::new(),
                        false,
                    )
                    .unwrap();
                    assert_eq!(view.session_count, 6);
                    assert_eq!(view.group_totals.len(), 3);
                    assert!(view.group_totals.values().all(|(count, _)| *count == 2));
                    assert_eq!(
                        view.sessions
                            .iter()
                            .map(|s| s.last_activity.clone())
                            .collect::<Vec<_>>(),
                        ordered[offset..offset + 2],
                        "{group_by}, descending={descending}, offset={offset}"
                    );
                }
            }
        }
    }
    #[test]
    fn csv_injection() {
        assert_eq!(csv_cell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
        assert_eq!(csv_cell("  +cmd"), "\"'  +cmd\"");
    }
    #[test]
    fn activity_not_last_day() {
        let s = Session {
            provider: "claude".into(),
            activity_days: vec!["2026-11-01".into(), "2026-11-03".into()],
            last_activity: "2026-11-03T12:00:00Z".into(),
            ..Session::default()
        };
        let mut q = Query {
            since: Some("2026-11-01".into()),
            until: Some("2026-11-01".into()),
            ..Query::default()
        };
        assert!(session_matches(&s, &q, "UTC"));
        q.since = Some("2026-11-02".into());
        q.until = q.since.clone();
        assert!(!session_matches(&s, &q, "UTC"));
    }
    #[test]
    fn date_validation() {
        assert!(validate(&Query {
            since: Some("2026-02-30".into()),
            ..Query::default()
        })
        .is_err());
    }
}
