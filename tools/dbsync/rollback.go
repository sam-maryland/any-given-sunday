package dbsync

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"

	_ "github.com/lib/pq" // PostgreSQL driver
)

// RollbackMigration rolls back the last applied migration
func RollbackMigration(ctx context.Context, databaseURL string, version string) error {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer db.Close()

	// Get the migration to rollback
	migration, err := getMigrationByVersion(ctx, db, version)
	if err != nil {
		return fmt.Errorf("failed to get migration: %w", err)
	}

	if migration == nil {
		return fmt.Errorf("migration %s not found or not applied", version)
	}

	// Start transaction
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Apply the down migration
	if migration.DownSQL != "" {
		_, err = tx.ExecContext(ctx, migration.DownSQL)
		if err != nil {
			return fmt.Errorf("failed to apply rollback: %w", err)
		}
	}

	// Remove migration record
	_, err = tx.ExecContext(ctx, "DELETE FROM schema_migrations WHERE version = $1", version)
	if err != nil {
		return fmt.Errorf("failed to remove migration record: %w", err)
	}

	// Commit transaction
	err = tx.Commit()
	if err != nil {
		return fmt.Errorf("failed to commit rollback: %w", err)
	}

	return nil
}

// getMigrationByVersion retrieves a specific migration by version
func getMigrationByVersion(ctx context.Context, db *sql.DB, version string) (*Migration, error) {
	var migration Migration
	err := db.QueryRowContext(ctx,
		"SELECT version, applied_at, checksum FROM schema_migrations WHERE version = $1",
		version).Scan(&migration.Version, &migration.AppliedAt, &migration.Checksum)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &migration, nil
}

// ListMigrations shows all applied migrations
func ListMigrations(ctx context.Context, databaseURL string) error {
	migrations, err := GetAppliedMigrations(ctx, databaseURL)
	if err != nil {
		// If table doesn't exist, that's OK - just means no migrations yet
		if strings.Contains(err.Error(), "does not exist") {
			fmt.Println("📋 No migrations table found - no migrations have been applied yet")
			return nil
		}
		return fmt.Errorf("failed to get migrations: %w", err)
	}

	if len(migrations) == 0 {
		fmt.Println("📋 No migrations have been applied yet")
		return nil
	}

	fmt.Println("📋 Applied Migrations")
	fmt.Println()

	for _, migration := range migrations {
		fmt.Printf("✅ %s", migration.Version)
		if migration.AppliedAt != nil {
			fmt.Printf(" (applied %s)", migration.AppliedAt.Format("2006-01-02 15:04:05"))
		}
		fmt.Println()
	}

	return nil
}

// RollbackLastMigration rolls back the most recently applied migration
func RollbackLastMigration() error {
	ctx := context.Background()

	// Get DATABASE_URL from environment
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL environment variable not set")
	}

	// Get applied migrations
	migrations, err := GetAppliedMigrations(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("failed to get migrations: %w", err)
	}

	if len(migrations) == 0 {
		fmt.Println("❌ No migrations to rollback")
		return nil
	}

	// Get the last migration
	lastMigration := migrations[len(migrations)-1]

	fmt.Printf("🔄 Rolling back migration: %s\n", lastMigration.Version)
	if lastMigration.AppliedAt != nil {
		fmt.Printf("   Applied at: %s\n", lastMigration.AppliedAt.Format("2006-01-02 15:04:05"))
	}
	fmt.Println()

	fmt.Print("Continue with rollback? (y/N): ")

	var response string
	fmt.Scanln(&response)

	if strings.ToLower(response) != "y" && strings.ToLower(response) != "yes" {
		fmt.Println("Rollback cancelled.")
		return nil
	}

	// Perform rollback
	err = RollbackMigration(ctx, databaseURL, lastMigration.Version)
	if err != nil {
		return fmt.Errorf("failed to rollback migration: %w", err)
	}

	fmt.Printf("✅ Migration %s rolled back successfully\n", lastMigration.Version)

	// Show current status
	fmt.Println()
	fmt.Println("🔍 Current status:")
	return ShowStatus()
}
