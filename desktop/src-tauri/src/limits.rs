use serde_json::Value;
use std::sync::LazyLock;

static LIMITS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../config/app_limits.json"))
        .expect("config/app_limits.json must be valid JSON")
});

pub fn value(section: &str, name: &str) -> u64 {
    LIMITS[section][name]
        .as_u64()
        .unwrap_or_else(|| panic!("missing integer app limit {section}.{name}"))
}

pub fn decimal(section: &str, name: &str) -> f64 {
    LIMITS[section][name]
        .as_f64()
        .unwrap_or_else(|| panic!("missing numeric app limit {section}.{name}"))
}

pub fn mebibytes(section: &str, name: &str) -> usize {
    value(section, name) as usize * 1024 * 1024
}
