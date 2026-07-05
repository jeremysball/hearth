package server

import (
	"database/sql"
	"fmt"
	"time"
)

// RunCLI handles `hearth <subcommand> ...` invocations that operate directly
// on the database instead of starting the HTTP server. This is the recovery
// path for a caregiver locked out of the app (removed from a family, or
// signed in on a device with no valid session and no linked OAuth identity):
// an operator with shell access to the server can mint an invite without
// going through the authenticated /api/invites endpoint. Returns true if it
// handled the command (caller should exit after); false means the args don't
// match any CLI subcommand and the caller should fall through to server.Run.
func RunCLI(args []string) bool {
	if len(args) < 1 || args[0] != "invite" {
		return false
	}
	cfg := loadConfig()
	db, err := openDB(cfg.DBPath)
	if err != nil {
		fmt.Println("opening database:", err)
		return true
	}
	defer db.Close()

	if len(args) < 2 {
		fmt.Println("usage: hearth invite [list | create <family_id>]")
		return true
	}
	switch args[1] {
	case "list":
		listFamiliesCLI(db)
	case "create":
		if len(args) < 3 {
			fmt.Println("usage: hearth invite create <family_id>")
			return true
		}
		token, err := createInviteCLI(db, args[2])
		if err != nil {
			fmt.Println(err)
			return true
		}
		base := cfg.PublicBaseURL
		if base == "" {
			base = "http://" + cfg.Host + ":" + cfg.Port
		}
		fmt.Println("Invite link (expires in 48h, single use):")
		fmt.Println(base + "/join/" + token)
	default:
		fmt.Println("usage: hearth invite [list | create <family_id>]")
	}
	return true
}

func listFamiliesCLI(db *sql.DB) {
	rows, err := db.Query(`
		SELECT b.family_id, b.name,
			(SELECT COUNT(*) FROM caregivers c WHERE c.family_id = b.family_id AND c.removed_at = ''),
			(SELECT COUNT(*) FROM log_entries e WHERE e.family_id = b.family_id AND e.deleted_at IS NULL)
		FROM babies b ORDER BY b.family_id`)
	if err != nil {
		fmt.Println("query error:", err)
		return
	}
	defer rows.Close()
	fmt.Printf("%-38s %-20s %-11s %s\n", "family_id", "baby", "caregivers", "entries")
	for rows.Next() {
		var familyID, name string
		var caregivers, entries int
		if err := rows.Scan(&familyID, &name, &caregivers, &entries); err != nil {
			continue
		}
		if name == "" {
			name = "(unnamed)"
		}
		fmt.Printf("%-38s %-20s %-11d %d\n", familyID, name, caregivers, entries)
	}
}

// createInviteCLI mints an invite for familyID and returns the raw token
// (not the hash) so the caller can build a /join/<token> link. Split out
// from RunCLI so it's testable without going through fmt/os.Args.
func createInviteCLI(db *sql.DB, familyID string) (string, error) {
	var exists string
	if err := db.QueryRow(`SELECT id FROM families WHERE id = ?`, familyID).Scan(&exists); err != nil {
		return "", fmt.Errorf("no such family: %s", familyID)
	}
	token := newID()
	expiresAt := time.Now().UTC().Add(inviteTTL).Format(time.RFC3339Nano)
	if _, err := db.Exec(`INSERT INTO invites (token_hash, family_id, created_by, expires_at) VALUES (?, ?, 'cli', ?)`,
		hashToken(token), familyID, expiresAt); err != nil {
		return "", fmt.Errorf("database error: %w", err)
	}
	return token, nil
}
