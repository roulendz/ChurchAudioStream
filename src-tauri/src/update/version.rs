//! Pure semver helpers wrapping the `semver` crate.
//!
//! Public surface (`Semver`, `parse_semver`, `compare`, `is_newer`) is the contract
//! Phase 2/3 depend on. The `semver` crate is wrapped behind this module so the
//! implementation can be swapped later without callers changing.

use std::fmt;

/// Parsed semver triple plus the original raw input string.
///
/// Field ordering (`major`, `minor`, `patch` BEFORE `raw`) is load-bearing:
/// `derive(Ord, PartialOrd)` walks fields in declaration order, so ordering is
/// numeric (0.9.0 < 0.10.0) and never influenced by the lexicographic raw string.
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Semver {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    raw: String,
}

impl Semver {
    /// Returns the original input string the `Semver` was parsed from.
    pub fn raw(&self) -> &str {
        &self.raw
    }
}

/// Hand-rolled parse-error enum (no `thiserror` dep). Carries context per variant.
#[derive(Debug)]
pub enum ParseError {
    Empty,
    Invalid { input: String, reason: String },
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::Empty => write!(f, "semver input is empty"),
            ParseError::Invalid { input, reason } => {
                write!(f, "semver parse failed for {input:?}: {reason}")
            }
        }
    }
}

impl std::error::Error for ParseError {}

/// Parse a semver string (e.g. `"0.1.2"`) into a `Semver`.
///
/// Empty input → `ParseError::Empty`. Anything the underlying `semver` crate
/// rejects → `ParseError::Invalid { input, reason }` carrying the original
/// input and the crate's error message for debugging.
pub fn parse_semver(input: &str) -> Result<Semver, ParseError> {
    if input.is_empty() {
        return Err(ParseError::Empty);
    }
    let parsed = semver::Version::parse(input).map_err(|error| ParseError::Invalid {
        input: input.to_string(),
        reason: error.to_string(),
    })?;
    Ok(Semver {
        major: parsed.major,
        minor: parsed.minor,
        patch: parsed.patch,
        raw: input.to_string(),
    })
}

/// Total ordering on `Semver` triples. Delegates to derived `Ord`.
pub fn compare(a: &Semver, b: &Semver) -> std::cmp::Ordering {
    a.cmp(b)
}

/// Returns `Ok(true)` iff `latest` parses to a strictly greater triple than `current`.
/// Equal versions and downgrades return `Ok(false)`. Either side failing to parse
/// propagates the `ParseError`.
pub fn is_newer(current: &str, latest: &str) -> Result<bool, ParseError> {
    let current_parsed = parse_semver(current)?;
    let latest_parsed = parse_semver(latest)?;
    Ok(latest_parsed > current_parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn parse_semver_accepts_valid() {
        let zero_one_two = parse_semver("0.1.2").unwrap();
        assert_eq!(zero_one_two.major, 0);
        assert_eq!(zero_one_two.minor, 1);
        assert_eq!(zero_one_two.patch, 2);
        assert_eq!(zero_one_two.raw(), "0.1.2");

        let one_zero_zero = parse_semver("1.0.0").unwrap();
        assert_eq!(one_zero_zero.major, 1);
        assert_eq!(one_zero_zero.minor, 0);
        assert_eq!(one_zero_zero.patch, 0);

        let two_ten_zero = parse_semver("2.10.0").unwrap();
        assert_eq!(two_ten_zero.major, 2);
        assert_eq!(two_ten_zero.minor, 10);
        assert_eq!(two_ten_zero.patch, 0);
    }

    #[test]
    fn parse_semver_rejects_invalid() {
        let abc = parse_semver("abc").unwrap_err();
        assert!(matches!(abc, ParseError::Invalid { .. }));

        let alpha_minor = parse_semver("1.x.0").unwrap_err();
        assert!(matches!(alpha_minor, ParseError::Invalid { .. }));
    }

    #[test]
    fn parse_semver_rejects_empty() {
        let empty = parse_semver("").unwrap_err();
        assert!(matches!(empty, ParseError::Empty));
    }

    #[test]
    fn compare_orders_correctly() {
        let a = parse_semver("0.1.2").unwrap();
        let b = parse_semver("0.1.3").unwrap();
        assert_eq!(compare(&a, &b), Ordering::Less);

        // Numeric ordering, NOT lexical: 0.9.0 < 0.10.0
        let nine = parse_semver("0.9.0").unwrap();
        let ten = parse_semver("0.10.0").unwrap();
        assert_eq!(compare(&nine, &ten), Ordering::Less);

        let one = parse_semver("1.0.0").unwrap();
        let zero_99 = parse_semver("0.99.99").unwrap();
        assert_eq!(compare(&one, &zero_99), Ordering::Greater);

        // Equality
        let same_a = parse_semver("0.1.2").unwrap();
        let same_b = parse_semver("0.1.2").unwrap();
        assert_eq!(compare(&same_a, &same_b), Ordering::Equal);
    }

    #[test]
    fn is_newer_handles_equal() {
        assert_eq!(is_newer("0.1.2", "0.1.2").unwrap(), false);
    }

    #[test]
    fn is_newer_handles_downgrade() {
        assert_eq!(is_newer("0.2.0", "0.1.0").unwrap(), false);
    }

    #[test]
    fn is_newer_handles_upgrade() {
        assert_eq!(is_newer("0.1.2", "0.1.3").unwrap(), true);
    }

    #[test]
    fn is_newer_propagates_parse_error_from_current() {
        let err = is_newer("abc", "0.1.0").unwrap_err();
        assert!(matches!(err, ParseError::Invalid { .. }));
    }

    #[test]
    fn is_newer_propagates_parse_error_from_latest() {
        let err = is_newer("0.1.0", "1.x.0").unwrap_err();
        assert!(matches!(err, ParseError::Invalid { .. }));
    }

    #[test]
    fn parse_error_displays_human_readable() {
        let empty_msg = format!("{}", ParseError::Empty);
        assert_eq!(empty_msg, "semver input is empty");

        let invalid_msg = format!(
            "{}",
            ParseError::Invalid {
                input: "abc".to_string(),
                reason: "unexpected character".to_string(),
            }
        );
        assert!(invalid_msg.contains("abc"));
        assert!(invalid_msg.contains("unexpected character"));
    }
}
