//! The extraction layer: an LLM "Shadow Kernel" plus a deterministic, offline
//! heuristic fallback so CORTEX still remembers things with no API key.

pub mod openrouter;

use crate::types::SemanticTriplet;
use std::collections::HashSet;

/// Lowercase ASCII only. Guarantees the result has *identical byte indices* to
/// the input (a full `str::to_lowercase` can change length — e.g. `İ` — and
/// would then panic when those indices are used to slice the original text).
fn ascii_lower(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_uppercase() {
                c.to_ascii_lowercase()
            } else {
                c
            }
        })
        .collect()
}

/// Deterministic pattern extraction. Intentionally narrow and high-precision:
/// on a free/local tier it is better to store few facts we are sure about than
/// to pollute the graph. Only the user's own turns are parsed.
pub fn push_triplet(
    out: &mut Vec<SemanticTriplet>,
    seen: &mut HashSet<(String, String, String)>,
    subject: &str,
    predicate: &str,
    object: &str,
    impact: u8,
    confidence: f32,
    overwrite: bool,
) {
    let triplet = SemanticTriplet {
        subject: subject.to_string(),
        predicate: predicate.to_string(),
        object: object.to_string(),
        confidence,
        impact,
        overwrite,
        sentence: String::new(),
    }
    .sanitized();
    if triplet.is_valid()
        && !triplet.subject.eq_ignore_ascii_case(&triplet.object)
        && seen.insert((
            triplet.subject.clone(),
            triplet.predicate.clone(),
            triplet.object.clone(),
        ))
    {
        out.push(triplet);
    }
}

fn heuristic_triplets(text: &str) -> Vec<SemanticTriplet> {
    const NEEDLES: &[(&str, &str, u8)] = &[
        (" prefers ", "prefers", 7),
        (" doesn't like ", "dislikes", 7),
        (" does not like ", "dislikes", 7),
        (" don't like ", "dislikes", 6),
        (" do not like ", "dislikes", 6),
        (" loves ", "loves", 8),
        (" hates ", "dislikes", 8),
        (" uses ", "uses", 5),
        (" works with ", "works_with", 6),
        (" is building ", "is_building", 7),
        (" is working on ", "is_working_on", 7),
        (" decided on ", "decided_on", 8),
        (" deployed to ", "deploys_to", 6),
        (" is allergic to ", "allergic_to", 10),
    ];
    const SELF: &[(&str, &str, u8)] = &[
        ("i am a ", "is_a", 10),
        ("i am an ", "is_a", 10),
        ("i'm a ", "is_a", 10),
        ("i'm an ", "is_a", 10),
        ("my name is ", "named", 10),
        ("i live in ", "lives_in", 9),
        ("i work at ", "works_at", 9),
        ("i work on ", "works_on", 8),
    ];

    let mut out: Vec<SemanticTriplet> = Vec::new();
    let mut seen: HashSet<(String, String, String)> = HashSet::new();

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        // Only the user's words become facts. Assistant turns carry the
        // `ASSISTANT` marker (storage::session::render_transcript) and are
        // skipped — that is what stops model hallucinations being stored as
        // truth about the user.
        let upper = line.to_ascii_uppercase();
        if upper.starts_with("ASSISTANT") || upper.starts_with("SYSTEM") || upper.starts_with("TOOL") {
            continue;
        }
        let body = line
            .strip_prefix("USER:")
            .or_else(|| line.strip_prefix("user:"))
            .unwrap_or(line)
            .trim();
        if body.is_empty() {
            continue;
        }
        let lower = ascii_lower(body);

        // Corrections ("use X instead of Y") must obsolete the earlier fact
        // rather than sit next to it as an unresolved contradiction.
        if let Some(pos) = lower.find("instead of") {
            let head = body[..pos].trim();
            let tail = body[pos + "instead of".len()..].trim();
            if !head.is_empty() && !tail.is_empty() {
                push_triplet(
                    &mut out, &mut seen, "User", "prefers", head, 9, 0.95, true,
                );
            }
        }

        for (needle, predicate, impact) in NEEDLES {
            if let Some(idx) = lower.find(needle) {
                let subject = &body[..idx];
                let object = &body[idx + needle.len()..];
                if !subject.trim().is_empty() && !object.trim().is_empty() {
                    push_triplet(
                        &mut out,
                        &mut seen,
                        subject,
                        predicate,
                        object,
                        *impact,
                        0.8,
                        false,
                    );
                }
            }
        }

        for (needle, predicate, impact) in SELF {
            if let Some(idx) = lower.find(needle) {
                let object = &body[idx + needle.len()..];
                if !object.trim().is_empty() {
                    push_triplet(&mut out, &mut seen, "User", predicate, object, *impact, 0.9, false);
                }
            }
        }

        // Hard rules: imperative invariants the user wants enforced forever,
        // hence impact 10 so the forgetting curve never retires them.
        for (prefix, predicate) in [
            ("always ", "must"),
            ("never ", "must_not"),
            ("only ", "only_permits"),
        ] {
            if lower.starts_with(prefix) {
                let object = &body[prefix.len()..];
                if !object.trim().is_empty() {
                    push_triplet(&mut out, &mut seen, "Project", predicate, object, 10, 0.85, false);
                }
            }
        }

        if out.len() >= 80 {
            break;
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_preferences_and_identity() {
        let got = heuristic_triplets("USER: I prefer Postgres over MySQL\nUSER: my name is Aryan\n");
        assert!(got.iter().any(|t| t.predicate == "prefers"));
        assert!(got
            .iter()
            .any(|t| t.predicate == "named" && t.object.contains("Aryan")));
    }

    #[test]
    fn never_extracts_facts_from_assistant_lines() {
        let got = heuristic_triplets(
            "ASSISTANT (not asserted by user): I use Mongo everywhere\nUSER: I prefer Postgres\n",
        );
        assert!(!got.iter().any(|t| t.object.contains("Mongo")));
        assert!(got.iter().any(|t| t.object.contains("Postgres")));
    }

    #[test]
    fn imperative_rules_get_lockable_impact() {
        let got = heuristic_triplets("USER: never use raw SQL queries");
        let rule = got
            .iter()
            .find(|t| t.predicate == "must_not")
            .expect("rule captured");
        assert_eq!(rule.impact, 10);
        assert!(rule.object.contains("raw SQL"));
    }

    #[test]
    fn corrections_are_marked_overwrite() {
        let got = heuristic_triplets("USER: use pnpm instead of npm");
        let t = got.iter().find(|t| t.overwrite).expect("correction flagged");
        assert_eq!(t.object, "use pnpm");
    }

    #[test]
    fn duplicates_collapse() {
        let got = heuristic_triplets("USER: I prefer Postgres\nUSER: I prefer Postgres\n");
        assert_eq!(got.len(), 1, "same fact must not be stored twice");
    }

    #[test]
    fn handles_non_ascii_without_panicking() {
        // 'İ' lowercases to two code points, so any index arithmetic that mixes
        // `to_lowercase` offsets with the original string would panic here.
        let noisy = format!("USER: İÎİ{lower}", lower = "i prefer rust and İstanbul");
        let got = heuristic_triplets(&noisy);
        assert!(got.len() <= 80); // the assertion we care about is: no panic
        assert_eq!(ascii_lower("İstanbul").len(), "İstanbul".len());
    }

    #[test]
    fn output_is_bounded() {
        let noisy: String = (0..500)
            .map(|i| format!("USER: I like thing{i} and item{i}\n"))
            .collect();
        assert!(heuristic_triplets(&noisy).len() <= 80);
    }
}
