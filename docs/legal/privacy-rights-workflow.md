# How rights requests are handled today (2026-10-14)

| Request | Who receives it | Mechanism in the product | Evidence | Gap |
|---|---|---|---|---|
| End customer asks to see / correct / delete their data | the **business** (the privacy draft tells customers to contact the business) | owner screen "customers" shows the record; export (CSV) of customers and appointments; "delete personal details" anonymises (name, phone, e-mail, notes, intake) | E2E `customers.spec`, `permission-matrix` (export is admin only and audited) | the customer has no self-service route and no way to reach the platform if the business does not answer: counsel must decide whether one is required |
| Business owner asks for access / export | self-service | account export (JSON, admin only), audit row written | `owner/account/export`, permission matrix | none known |
| Business owner asks for deletion | self-service | typed business name, 14-day grace, customers notified, cancel possible during grace, then purge | `140_account_lifecycle`, `account.spec` | owner e-mail receipt of completion: tested? **NOT TESTED** |
| Withdraw consent | n/a | there is no optional processing and no marketing mail | consent test | revisit when any optional category appears |
| Request log (type, received, owner, status) | n/a | none (there is no ticket system) | none | P2: keep a simple register once a real contact address exists |
| Identity verification | the business knows its own customers | none built | none | counsel: acceptable? |

Guard rails: a deleted customer's future appointments must be cancelled first (the function refuses with `has_upcoming`); exports are audited and need the admin role; no secrets appear in tickets because there is no ticket system.
