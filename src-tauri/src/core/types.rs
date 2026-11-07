use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
}
impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl From<rusqlite::Error> for AppError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new(
            "DATABASE",
            "The local database could not be read or written.",
        )
    }
}
pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
    pub total: u64,
}
impl Tokens {
    pub fn add(&mut self, t: &Self) {
        self.input += t.input;
        self.output += t.output;
        self.cache_read += t.cache_read;
        self.cache_creation += t.cache_creation;
        self.total += t.total;
    }
}
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub tokens: Tokens,
    pub cost_micros: i64,
    #[serde(default)]
    pub period_cost_micros: Option<i64>,
    #[serde(default)]
    pub lifetime_cost_micros: Option<i64>,
    pub missing_pricing: bool,
    pub stored_cost_micros: Option<i64>,
    pub is_fallback: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub key: String,
    pub id: String,
    pub provider: String,
    pub source_id: String,
    pub title: String,
    pub title_provenance: String,
    pub native_title: Option<String>,
    pub project: String,
    pub project_path: String,
    pub source_path: Option<String>,
    pub first_activity: String,
    pub last_activity: String,
    pub activity_days: Vec<String>,
    pub tokens: Tokens,
    pub cost_micros: i64,
    #[serde(default)]
    pub daily_usage: Option<Vec<DailyUsage>>,
    #[serde(default)]
    pub period_cost_micros: Option<i64>,
    pub models: Vec<ModelUsage>,
    pub missing_pricing: bool,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub source_status: String,
}
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub date: String,
    pub provider: String,
    pub tokens: Tokens,
    pub cost_micros: i64,
    pub models: Vec<ModelUsage>,
    pub missing_pricing: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub provider: String,
    pub root: String,
    pub status: String,
    pub session_count: usize,
    pub warning: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(default)]
    pub settings_fingerprint: String,
    pub scanned_at: String,
    pub engine_version: String,
    pub timezone: String,
    pub cost_mode: String,
    pub sessions: Vec<Session>,
    pub daily: Vec<DailyUsage>,
    pub sources: Vec<Source>,
    pub warnings: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub timezone: String,
    pub theme: String,
    pub week_start: String,
    pub default_range: String,
    pub claude_roots: Vec<String>,
    pub codex_roots: Vec<String>,
    pub engine_path: Option<String>,
    pub cost_mode: String,
    pub codex_speed: String,
    pub claude_monthly_allowance_usd: Option<f64>,
    pub codex_monthly_allowance_usd: Option<f64>,
    pub prompt_fallback: bool,
    pub foreground_seconds: u64,
    pub background_seconds: u64,
    pub tray_enabled: bool,
    pub tray_title: bool,
    pub close_to_tray: bool,
    pub onboarded: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            timezone: "local".into(),
            theme: "system".into(),
            week_start: "monday".into(),
            default_range: "30d".into(),
            claude_roots: vec![],
            codex_roots: vec![],
            engine_path: None,
            cost_mode: "auto".into(),
            codex_speed: "auto".into(),
            claude_monthly_allowance_usd: None,
            codex_monthly_allowance_usd: None,
            prompt_fallback: true,
            foreground_seconds: 60,
            background_seconds: 300,
            tray_enabled: true,
            tray_title: false,
            close_to_tray: true,
            onboarded: false,
        }
    }
}
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub title: Option<String>,
    pub favorite: bool,
    pub tags: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct Query {
    pub providers: Vec<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub search: String,
    pub projects: Vec<String>,
    pub models: Vec<String>,
    pub favorite: bool,
    pub tag: String,
    pub provenance: String,
    pub source_id: String,
    pub min_cost: Option<f64>,
    pub max_cost: Option<f64>,
    pub min_tokens: Option<u64>,
    pub max_tokens: Option<u64>,
    pub sort: String,
    pub descending: bool,
    pub group_by: String,
    pub descending_groups: bool,
    pub week_start: String,
    pub offset: usize,
    pub limit: usize,
}
impl Default for Query {
    fn default() -> Self {
        Self {
            providers: vec![],
            since: None,
            until: None,
            search: String::new(),
            projects: vec![],
            models: vec![],
            favorite: false,
            tag: String::new(),
            provenance: String::new(),
            source_id: String::new(),
            min_cost: None,
            max_cost: None,
            min_tokens: None,
            max_tokens: None,
            sort: "last".into(),
            descending: true,
            group_by: "day".into(),
            descending_groups: true,
            week_start: "monday".into(),
            offset: 0,
            limit: 100,
        }
    }
}
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub tokens: Tokens,
    pub cost_micros: i64,
    pub lifetime_cost_micros: i64,
    pub sessions: usize,
    pub projects: usize,
    pub active_days: usize,
    pub missing_pricing: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub key: String,
    pub name: String,
    pub tokens: Tokens,
    pub cost_micros: i64,
    pub period_cost_micros: Option<i64>,
    pub sessions: usize,
    pub last_activity: String,
    pub claude_micros: i64,
    pub codex_micros: i64,
    pub top_model: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ViewData {
    pub group_totals: std::collections::BTreeMap<String, (usize, i64)>,
    pub group_period_totals: std::collections::BTreeMap<String, Option<i64>>,
    pub provider_lifetime_costs: std::collections::BTreeMap<String, i64>,
    pub summary: Summary,
    pub previous: Option<Summary>,
    pub sessions: Vec<Session>,
    pub session_count: usize,
    pub daily: Vec<DailyUsage>,
    pub projects: Vec<ProjectSummary>,
    pub models: Vec<ModelUsage>,
    pub top_sessions: Vec<Session>,
    pub sources: Vec<Source>,
    pub scanned_at: String,
    pub engine_version: String,
    pub timezone: String,
    pub cost_mode: String,
    pub stale: bool,
    pub warnings: Vec<String>,
    pub available_projects: Vec<(String, String)>,
    pub available_models: Vec<String>,
}
