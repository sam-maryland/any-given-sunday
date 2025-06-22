package dbsync

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/lib/pq" // PostgreSQL driver
)

// GenerateMigrationFromDiff creates a migration from schema differences
func GenerateMigrationFromDiff(diff *SchemaDiff, name string) (*Migration, error) {
	if diff == nil {
		return nil, fmt.Errorf("schema diff is nil")
	}

	// Generate migration version (timestamp)
	version := time.Now().Format("20060102_150405")
	if name == "" {
		name = "auto_migration"
	}

	var upSQL strings.Builder
	var downSQL strings.Builder

	// Add header comments
	upSQL.WriteString(fmt.Sprintf("-- Migration: %s_%s\n", version, name))
	upSQL.WriteString(fmt.Sprintf("-- Generated at: %s\n\n", time.Now().Format(time.RFC3339)))

	downSQL.WriteString(fmt.Sprintf("-- Rollback for migration: %s_%s\n", version, name))
	downSQL.WriteString(fmt.Sprintf("-- Generated at: %s\n\n", time.Now().Format(time.RFC3339)))

	// Generate SQL for missing tables
	for _, table := range diff.MissingTables {
		upSQL.WriteString(generateCreateTableSQL(table))
		upSQL.WriteString("\n")
		
		downSQL.WriteString(fmt.Sprintf("DROP TABLE IF EXISTS %s;\n", table.Name))
	}

	// Generate SQL for missing views
	for _, view := range diff.MissingViews {
		upSQL.WriteString(view.Definition)
		upSQL.WriteString(";\n\n")
		
		downSQL.WriteString(fmt.Sprintf("DROP VIEW IF EXISTS %s;\n", view.Name))
	}

	// Generate SQL for missing indexes
	for _, index := range diff.MissingIndexes {
		upSQL.WriteString(generateCreateIndexSQL(index))
		upSQL.WriteString("\n")
		
		downSQL.WriteString(fmt.Sprintf("DROP INDEX IF EXISTS %s;\n", index.Name))
	}

	migration := &Migration{
		Version: version + "_" + name,
		Name:    name,
		UpSQL:   upSQL.String(),
		DownSQL: downSQL.String(),
	}

	// Calculate checksum
	migration.Checksum = calculateChecksum(migration.UpSQL + migration.DownSQL)

	return migration, nil
}

// generateCreateTableSQL generates CREATE TABLE SQL from a Table struct
func generateCreateTableSQL(table Table) string {
	var sql strings.Builder
	
	sql.WriteString(fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (\n", table.Name))
	
	for i, column := range table.Columns {
		sql.WriteString(fmt.Sprintf("    %s %s", column.Name, column.Type))
		
		if column.NotNull {
			sql.WriteString(" NOT NULL")
		}
		
		if column.DefaultValue != nil {
			sql.WriteString(fmt.Sprintf(" DEFAULT %s", *column.DefaultValue))
		}
		
		if column.IsPrimaryKey {
			sql.WriteString(" PRIMARY KEY")
		}
		
		if i < len(table.Columns)-1 {
			sql.WriteString(",")
		}
		sql.WriteString("\n")
	}
	
	sql.WriteString(");")
	
	return sql.String()
}

// generateCreateIndexSQL generates CREATE INDEX SQL from an Index struct
func generateCreateIndexSQL(index Index) string {
	var sql strings.Builder
	
	if index.Unique {
		sql.WriteString("CREATE UNIQUE INDEX IF NOT EXISTS ")
	} else {
		sql.WriteString("CREATE INDEX IF NOT EXISTS ")
	}
	
	sql.WriteString(fmt.Sprintf("%s ON %s", index.Name, index.Table))
	
	if len(index.Columns) > 0 {
		sql.WriteString("(")
		sql.WriteString(strings.Join(index.Columns, ", "))
		sql.WriteString(")")
	}
	
	sql.WriteString(";")
	
	return sql.String()
}

// SaveMigrationToFile saves a migration to the migrations directory
func SaveMigrationToFile(migration *Migration) (string, error) {
	filename := fmt.Sprintf("%s.sql", migration.Version)
	filePath := filepath.Join("migrations", filename)
	
	var content strings.Builder
	content.WriteString("-- +migrate Up\n")
	content.WriteString(migration.UpSQL)
	content.WriteString("\n-- +migrate Down\n")
	content.WriteString(migration.DownSQL)
	
	err := os.WriteFile(filePath, []byte(content.String()), 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write migration file: %w", err)
	}
	
	return filePath, nil
}

// EnsureMigrationsTable creates the schema_migrations table if it doesn't exist
func EnsureMigrationsTable(ctx context.Context, databaseURL string) error {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer db.Close()

	createTableSQL := `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMP DEFAULT NOW(),
			checksum VARCHAR(64) NOT NULL
		);
	`

	_, err = db.ExecContext(ctx, createTableSQL)
	if err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	return nil
}

// ApplyMigration applies a migration to the database
func ApplyMigration(ctx context.Context, databaseURL string, migration *Migration) error {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer db.Close()

	// Start transaction
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Check if migration already applied
	var count int
	err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations WHERE version = $1", migration.Version).Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check migration status: %w", err)
	}

	if count > 0 {
		return fmt.Errorf("migration %s already applied", migration.Version)
	}

	// Apply the migration
	_, err = tx.ExecContext(ctx, migration.UpSQL)
	if err != nil {
		return fmt.Errorf("failed to apply migration: %w", err)
	}

	// Record the migration
	_, err = tx.ExecContext(ctx, 
		"INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
		migration.Version, migration.Checksum)
	if err != nil {
		return fmt.Errorf("failed to record migration: %w", err)
	}

	// Commit transaction
	err = tx.Commit()
	if err != nil {
		return fmt.Errorf("failed to commit migration: %w", err)
	}

	migration.AppliedAt = &time.Time{}
	*migration.AppliedAt = time.Now()

	return nil
}

// GetAppliedMigrations returns a list of applied migrations
func GetAppliedMigrations(ctx context.Context, databaseURL string) ([]Migration, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}
	defer db.Close()

	// Check if migrations table exists
	var exists bool
	err = db.QueryRowContext(ctx, 
		"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'schema_migrations')").Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("failed to check migrations table: %w", err)
	}

	if !exists {
		return []Migration{}, nil
	}

	rows, err := db.QueryContext(ctx, 
		"SELECT version, applied_at, checksum FROM schema_migrations ORDER BY applied_at")
	if err != nil {
		return nil, fmt.Errorf("failed to query migrations: %w", err)
	}
	defer rows.Close()

	var migrations []Migration
	for rows.Next() {
		var migration Migration
		err := rows.Scan(&migration.Version, &migration.AppliedAt, &migration.Checksum)
		if err != nil {
			return nil, fmt.Errorf("failed to scan migration: %w", err)
		}
		migrations = append(migrations, migration)
	}

	return migrations, rows.Err()
}

// calculateChecksum calculates a simple checksum for migration content
func calculateChecksum(content string) string {
	// Simple checksum implementation - in production, use crypto/sha256
	hash := 0
	for _, char := range content {
		hash = hash*31 + int(char)
	}
	return fmt.Sprintf("%x", hash)
}