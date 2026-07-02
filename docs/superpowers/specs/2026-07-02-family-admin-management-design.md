# Family Admin Management Design

## Goal

Give families one simple administrator without introducing a full permission system. The first active family member manages caregiver roles and removes access for members who should leave the family. Removed members keep historical attribution on old log entries.

## Current Context

- `caregivers` already stores `display_name`, `role`, `photo`, `updated_at`, and `created_at`.
- `GET /api/caregivers` returns caregivers for the current family ordered by `created_at`.
- Profile renders the caregiver list in `js/profile.js` and lets the current caregiver update only their own photo.
- Log entries store `created_by`; the UI resolves author names from cached caregiver data.
- Sessions identify `caregiver_id` and `family_id`.

## Data Model

Add `removed_at TEXT` to `caregivers`. Because Hearth applies `CREATE TABLE IF NOT EXISTS` on startup and has no migration runner, the server must also ensure the column exists for existing SQLite databases before caregiver queries use it.

Active caregivers have an empty `removed_at`. Removed caregivers stay in the table so old log entries can still resolve their name, role, and photo. The app treats removed caregivers as inactive members, not deleted records.

The family admin is the first active caregiver by `created_at`. No `is_admin` column is stored. If the first caregiver is removed through a future manual repair, the next active caregiver becomes admin.

Allowed editable roles are:

- `Parent`
- `Partner`
- `Caregiver`

## API Behavior

### List Caregivers

`GET /api/caregivers` returns active caregivers ordered by `created_at`. `GET /api/caregivers?includeRemoved=1` returns active and removed caregivers for attribution caches, still ordered by `created_at`. Each row includes:

- `id`
- `displayName`
- `role`
- `photo`
- `isAdmin`
- `removedAt`

The first active row has `isAdmin: true`. Removed rows always have `isAdmin: false`.

### Change Role

Add an admin-only endpoint to change a caregiver role.

Input: caregiver ID and one of the allowed roles.

Rules:

- The requester must be the current admin.
- The target must belong to the same family.
- The target must be active.
- The admin cannot change their own role in this first version.
- Invalid roles return `400`.
- Non-admin requests return `403`.

On success, update `role` and `updated_at`, broadcast the family update, and return `204`.

### Remove Caregiver

Add an admin-only endpoint to remove a caregiver from the family.

Rules:

- The requester must be the current admin.
- The target must belong to the same family.
- The target must be active.
- The admin cannot remove themselves.
- Non-admin requests return `403`.

On success:

- Set `removed_at` and `updated_at` on the target caregiver.
- Delete the target caregiver's sessions.
- Broadcast the family update.
- Return `204`.

## Authentication

Session lookup must reject sessions for removed caregivers. A removed caregiver loses access on their next authenticated request, even if their browser still has a session cookie.

## Historical Attribution

Removed caregivers stay in the database. Old log entries keep `created_by`, and attribution resolves removed caregivers from `GET /api/caregivers?includeRemoved=1`. The Profile Settings member list filters to active caregivers only.

## UI Behavior

In Profile settings:

- Show the admin with a crown badge or crown ring around their avatar.
- Show role text for every active caregiver.
- Let every caregiver change only their own photo.
- Show role controls and a remove action only to the current admin.
- Hide admin controls for the admin row, so the admin cannot change their own role or remove themselves from the UI.
- Use existing Hearth controls and rounded card styling.

Removal should ask for confirmation before it revokes access. Successful role changes and removals show a toast.

## Error Handling

- If role change or removal fails, keep the local caregiver list unchanged and show a toast.
- If a caregiver was already removed, the server treats the target as not found or inactive.
- If the current user loses access, auth rejection sends them through the existing signed-out or onboarding path.

## Testing

Backend tests cover:

- The first active caregiver receives `isAdmin`.
- Removed caregivers do not appear in the active Settings list.
- Admins can change another caregiver's role.
- Non-admins cannot change roles.
- Admins can soft-remove another caregiver.
- Non-admins cannot remove caregivers.
- Admins cannot remove themselves.
- Removal deletes the target caregiver's sessions.
- Auth rejects sessions for removed caregivers.

Frontend or browser tests cover the practical UI path where feasible:

- Settings shows the admin crown.
- Admin controls appear only for admins and only on other members.
- Role changes update the visible role after success.
- Removal removes the member from the active list after confirmation.

## Out Of Scope

- Admin transfer UI.
- Multiple admins.
- Invite permissions by role.
- Restoring removed caregivers.
- Desktop layout work.
