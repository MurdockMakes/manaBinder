# Visibility, retention and support policy draft

Public: nickname, binder cards/printing/finish/condition/quantity/notes and chosen store affiliations. Choosing stores reveals places you may trade. Private: email, collection locations, wanted list, account export, and trades visible only to their participants. Never put sensitive information in public binder notes.

Passwords use salted scrypt; bearer sessions and single-use account tokens are hashed in PostgreSQL. Queued account emails are encrypted and cleared after delivery; development file-mail output is private local test material and must not be served or deployed. Operators must protect and clean local test directories.

The separate scheduler runs cleanup approximately every five seconds while it is healthy: expired sessions and account tokens are deleted, encrypted mail rows expire after one day, private quote prices are removed after 30 days, notifications after 90 days, and resolved reports after 90 days. Failed mail requires operator monitoring; account tokens expire in 30 minutes. Trade records and unresolved safety reports are retained until account deletion or operator handling. Infrastructure logs/backups need a separate retention policy selected before launch.

Account export returns the profile/inventory/wanted data, trade summaries, block list and submitted reports. Passwords/tokens/internal quote prices are excluded. Account deletion requires the current password and removes its active/completed trade history (including the counterpart's copy), inventory and sessions. Reports/moderation audit entries retain a detached reference where applicable. Deletion from historical backups follows the deployment's approved backup expiry; after restoring an older backup, reconcile deletion requests before reopening access.

Block/report controls are in Profile → Account and safety. Copy the other participant ID from trade history. Blocking cancels active trades and hides counterpart binders for that logged-in user; it does not hide public listings from anonymous visitors. Admin access is restricted to operator-configured account IDs and audited.

**Before public launch:** the owner must supply a support/contact address, moderation owner, deletion/backup-retention procedure and any jurisdiction-specific notices. This document is a product policy draft, not a legal compliance claim.
