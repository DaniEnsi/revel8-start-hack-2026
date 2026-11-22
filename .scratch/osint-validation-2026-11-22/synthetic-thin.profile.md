# OSINT — Tom Müller (Co-Founder) @ revel8
Requested search location (metadata, not evidence): Munich,Bavaria,Germany (country DE)
Identity rule: full name + nearby company required; explicit location conflicts are quarantined.

=== ACCEPTED IDENTITY EVIDENCE START ===
(No sources passed identity validation.)
=== ACCEPTED IDENTITY EVIDENCE END ===

=== IDENTITY CONFLICTS / WRONG-FACT TRAPS START ===
- field=location; values=Zurich; trap=does not match the requested location; record quarantined. Requested location: Munich,Bavaria,Germany. Do not assert the conflicting place as the target's current location. Source: https://example.test/wrong-company
- field=identity; values=Rivero; trap=same-name record lacked target-company corroboration and was quarantined; never transfer its facts or alternative affiliations to the target. Source: https://example.test/wrong-company
- field=location; values=Berlin; trap=does not match the requested location; record quarantined. Requested location: Munich,Bavaria,Germany. Do not assert the conflicting place as the target's current location. Source: https://example.test/wrong-city
=== IDENTITY CONFLICTS / WRONG-FACT TRAPS END ===

=== QUARANTINED SOURCES / METADATA ONLY START ===
- REJECTED: Tom Müller — CEO at Rivero | Source URL: https://example.test/wrong-company | Final URL: https://example.test/wrong-company | name=exact | reasons=target company not corroborated near the full name; conflicting location(s) without requested-location evidence: Zurich
- REJECTED: Tom Müller — revel8 Berlin | Source URL: https://example.test/wrong-city | Final URL: https://example.test/wrong-city | name=exact | reasons=conflicting location(s) without requested-location evidence: Berlin
=== QUARANTINED SOURCES / METADATA ONLY END ===
