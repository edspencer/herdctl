# herdctl Licensing Strategy

> **Status**: Working document - not the final license
> **Last Updated**: 2025-01-20

This document captures our thinking on licensing for herdctl. The actual license will be finalized before public release.

---

## Goals

1. **Free for individuals and small businesses** - Hobbyists, solopreneurs, startups, and small teams should be able to use herdctl without paying
2. **Paid for larger organizations** - Companies with significant resources should contribute financially
3. **Source available** - The code should be visible and auditable
4. **Protect against cloud providers** - Prevent AWS/GCP/Azure from offering "herdctl as a service" without contributing

---

## Proposed Thresholds

**Free tier (Community License):**
- Individuals and hobbyists
- Organizations with **fewer than 20 employees** (full-time or part-time)
- AND organizations with **less than $5 million** in total funding or annual revenue

**Paid tier (Commercial License) required when:**
- Organization has **20 or more employees**, OR
- Organization has **$5 million or more** in funding or annual revenue

---

## Recommended License: Custom PolyForm-style

Based on the [PolyForm Small Business License](https://polyformproject.org/licenses/small-business/1.0.0/) with modifications.

### Example License Text

```
herdctl Community License
Version 1.0

Copyright (c) 2025 Ed Spencer

Permission is hereby granted, free of charge, to any person or organization
(the "User") obtaining a copy of this software and associated documentation
files (the "Software"), to use, copy, modify, and distribute the Software,
subject to the following conditions:

1. SMALL BUSINESS EXEMPTION

   This license grants free usage rights to:

   a) Individual persons using the Software for any purpose

   b) Organizations that meet ALL of the following criteria:
      - Fewer than 20 employees (including full-time, part-time, and contractors)
      - Less than $5,000,000 USD in total funding received, AND
      - Less than $5,000,000 USD in annual revenue

   Organizations must reassess their eligibility annually.

2. COMMERCIAL LICENSE REQUIRED

   Organizations that do NOT qualify for the Small Business Exemption must
   obtain a Commercial License before using the Software in production.

   Contact: licensing@herdctl.dev

3. RESTRICTIONS

   Regardless of organization size, the following uses require a Commercial License:

   a) Offering the Software as a hosted service to third parties
   b) Embedding the Software in a product sold to others
   c) Using the Software to provide managed services

4. ATTRIBUTION

   All copies or substantial portions of the Software must include this
   license and copyright notice.

5. NO WARRANTY

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

6. FUTURE OPEN SOURCE CONVERSION

   This Software will be relicensed under the Apache License 2.0 on
   [DATE + 3 YEARS], at which point all restrictions in this license
   will be removed.
```

---

## Pricing Options (To Be Decided)

### Option A: Per-Seat Recurring

| Tier | Price | Notes |
|------|-------|-------|
| Community | Free | <20 employees, <$5M funding |
| Team | $50/user/month | Billed annually |
| Enterprise | Custom | Volume discounts, support SLA |

**Pros:** Predictable revenue, scales with customer size
**Cons:** Ongoing commitment from customers, harder to sell one-time

### Option B: One-Time Perpetual

| Tier | Price | Notes |
|------|-------|-------|
| Community | Free | <20 employees, <$5M funding |
| Professional | $500/user | One-time, perpetual license |
| Site License | $25,000 | Unlimited users, one organization |
| Enterprise | Custom | Multi-year support, custom terms |

**Pros:** Attractive to budget-conscious buyers, simpler procurement
**Cons:** Need to charge more upfront, no recurring revenue

### Option C: Hybrid

| Tier | Price | Notes |
|------|-------|-------|
| Community | Free | <20 employees, <$5M funding |
| Professional | $500/user one-time OR $50/user/month | Customer choice |
| Site License | $25,000 one-time OR $10,000/year | Customer choice |

**Pros:** Maximum flexibility
**Cons:** Complex to manage

---

## Comparison with Similar Projects

| Project | License | Pricing |
|---------|---------|---------|
| Sentry | FSL → Apache 2.0 | Free self-host, paid cloud |
| GitLab | MIT (CE) / Proprietary (EE) | Tiers based on features |
| CockroachDB | BSL → Apache 2.0 | Free core, paid enterprise |
| HashiCorp (Terraform) | BSL | Free core, paid cloud/enterprise |
| n8n | Sustainable Use License | <$10M revenue free, paid above |
| Cal.com | AGPLv3 + Commercial | Free self-host, paid cloud + features |

---

## Open Questions

1. **Should the threshold be employees OR funding/revenue, or AND?**
   - Current proposal: Must meet BOTH criteria (fewer than 20 employees AND less than $5M)
   - Alternative: Either threshold triggers paid tier

2. **What about non-profits and educational institutions?**
   - Could add explicit exemption for 501(c)(3) and educational use

3. **How do we handle contractors?**
   - Current: Counted as employees
   - Alternative: Only count W-2/full-time employees

4. **Geographic pricing?**
   - Could offer reduced pricing for certain regions

5. **Open source conversion timeline?**
   - 2 years? 3 years? 4 years?
   - Some projects (like Sentry's FSL) use 2 years

---

## Next Steps

- [ ] Consult with a lawyer to finalize license text
- [ ] Decide on pricing model
- [ ] Set up licensing@herdctl.dev
- [ ] Create license purchase/verification system
- [ ] Add license check to CLI (optional, honor system initially?)

---

## Notes

- The license should be clearly visible in the repo (LICENSE file)
- README should explain the licensing clearly
- Consider a "License FAQ" page on herdctl.dev
- Keep the license simple enough that people actually read it
