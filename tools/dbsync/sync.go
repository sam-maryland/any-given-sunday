package dbsync

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"
)

// ShowStatus displays the current sync status between local schema and Supabase
func ShowStatus() error {
	ctx := context.Background()
	
	// Get DATABASE_URL from environment
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL environment variable not set")
	}

	// Parse local schema
	localSchema, err := ParseSchemaFile("pkg/db/schema.sql")
	if err != nil {
		return fmt.Errorf("failed to parse local schema: %w", err)
	}

	// Get remote schema
	remoteSchema, err := GetSupabaseSchema(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("failed to get remote schema: %w", err)
	}

	// Compare schemas
	comparison := CompareSchemas(localSchema, remoteSchema)

	// Display status
	fmt.Println("📊 Database Schema Status")
	fmt.Println()
	fmt.Println("Local Schema:  pkg/db/schema.sql")
	fmt.Println("Remote Schema: Supabase Production")
	fmt.Println()

	if comparison.InSync {
		fmt.Println("Status: ✅ IN SYNC")
		fmt.Println("No changes needed")
	} else {
		fmt.Println("Status: 🔴 OUT OF SYNC")
		
		totalChanges := len(comparison.Differences.MissingTables) +
			len(comparison.Differences.MissingViews) +
			len(comparison.Differences.MissingIndexes) +
			len(comparison.Differences.ExtraTables) +
			len(comparison.Differences.ExtraViews) +
			len(comparison.Differences.ExtraIndexes)
		
		fmt.Printf("Pending Changes: %d\n", totalChanges)
		fmt.Println()

		if len(comparison.Differences.MissingTables) > 0 {
			fmt.Println("🔍 Missing Tables in Supabase:")
			for _, table := range comparison.Differences.MissingTables {
				fmt.Printf("  - TABLE %s (%d columns)\n", table.Name, len(table.Columns))
			}
		}

		if len(comparison.Differences.MissingViews) > 0 {
			fmt.Println("🔍 Missing Views in Supabase:")
			for _, view := range comparison.Differences.MissingViews {
				fmt.Printf("  - VIEW %s\n", view.Name)
			}
		}

		if len(comparison.Differences.MissingIndexes) > 0 {
			fmt.Println("🔍 Missing Indexes in Supabase:")
			for _, index := range comparison.Differences.MissingIndexes {
				fmt.Printf("  - INDEX %s ON %s\n", index.Name, index.Table)
			}
		}

		if len(comparison.Differences.ExtraTables) > 0 {
			fmt.Println("⚠️  Extra Tables in Supabase (not in local schema):")
			for _, table := range comparison.Differences.ExtraTables {
				fmt.Printf("  - TABLE %s\n", table.Name)
			}
		}

		if len(comparison.Differences.ExtraViews) > 0 {
			fmt.Println("⚠️  Extra Views in Supabase (not in local schema):")
			for _, view := range comparison.Differences.ExtraViews {
				fmt.Printf("  - VIEW %s\n", view.Name)
			}
		}

		if len(comparison.Differences.ExtraIndexes) > 0 {
			fmt.Println("⚠️  Extra Indexes in Supabase (not in local schema):")
			for _, index := range comparison.Differences.ExtraIndexes {
				fmt.Printf("  - INDEX %s ON %s\n", index.Name, index.Table)
			}
		}

		fmt.Println()
		fmt.Println("Run 'mage db:diff' for detailed comparison")
		fmt.Println("Run 'mage db:sync' to apply changes")
	}

	return nil
}

// ShowDifferences displays detailed differences between local and remote schemas
func ShowDifferences() error {
	ctx := context.Background()
	
	// Get DATABASE_URL from environment
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL environment variable not set")
	}

	// Parse local schema
	localSchema, err := ParseSchemaFile("pkg/db/schema.sql")
	if err != nil {
		return fmt.Errorf("failed to parse local schema: %w", err)
	}

	// Get remote schema
	remoteSchema, err := GetSupabaseSchema(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("failed to get remote schema: %w", err)
	}

	// Compare schemas
	comparison := CompareSchemas(localSchema, remoteSchema)

	fmt.Println("📋 Detailed Schema Differences")
	fmt.Println()

	if comparison.InSync {
		fmt.Println("✅ Schemas are in sync - no differences found")
		return nil
	}

	// Show detailed differences
	if len(comparison.Differences.MissingTables) > 0 {
		fmt.Println("➕ Tables to CREATE in Supabase:")
		for _, table := range comparison.Differences.MissingTables {
			fmt.Printf("\nCREATE TABLE %s (\n", table.Name)
			for i, col := range table.Columns {
				fmt.Printf("  %s %s", col.Name, col.Type)
				if col.NotNull {
					fmt.Printf(" NOT NULL")
				}
				if col.DefaultValue != nil {
					fmt.Printf(" DEFAULT '%s'", *col.DefaultValue)
				}
				if i < len(table.Columns)-1 {
					fmt.Printf(",")
				}
				fmt.Println()
			}
			fmt.Println(");")
		}
	}

	if len(comparison.Differences.MissingViews) > 0 {
		fmt.Println("\n➕ Views to CREATE in Supabase:")
		for _, view := range comparison.Differences.MissingViews {
			fmt.Printf("\n-- View: %s\n", view.Name)
			fmt.Println(view.Definition)
		}
	}

	if len(comparison.Differences.MissingIndexes) > 0 {
		fmt.Println("\n➕ Indexes to CREATE in Supabase:")
		for _, index := range comparison.Differences.MissingIndexes {
			fmt.Printf("CREATE INDEX %s ON %s;\n", index.Name, index.Table)
		}
	}

	if len(comparison.Differences.ExtraTables) > 0 {
		fmt.Println("\n⚠️  Extra tables in Supabase (consider adding to schema.sql or dropping):")
		for _, table := range comparison.Differences.ExtraTables {
			fmt.Printf("  - %s\n", table.Name)
		}
	}

	if len(comparison.Differences.ExtraViews) > 0 {
		fmt.Println("\n⚠️  Extra views in Supabase (consider adding to schema.sql or dropping):")
		for _, view := range comparison.Differences.ExtraViews {
			fmt.Printf("  - %s\n", view.Name)
		}
	}

	if len(comparison.Differences.ExtraIndexes) > 0 {
		fmt.Println("\n⚠️  Extra indexes in Supabase (consider adding to schema.sql or dropping):")
		for _, index := range comparison.Differences.ExtraIndexes {
			fmt.Printf("  - %s ON %s\n", index.Name, index.Table)
		}
	}

	return nil
}

// ApplyChanges generates and applies a migration to sync local schema with Supabase
func ApplyChanges() error {
	ctx := context.Background()
	
	// Get DATABASE_URL from environment
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL environment variable not set")
	}

	// Parse local schema
	localSchema, err := ParseSchemaFile("pkg/db/schema.sql")
	if err != nil {
		return fmt.Errorf("failed to parse local schema: %w", err)
	}

	// Get remote schema
	remoteSchema, err := GetSupabaseSchema(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("failed to get remote schema: %w", err)
	}

	// Compare schemas
	comparison := CompareSchemas(localSchema, remoteSchema)

	if comparison.InSync {
		fmt.Println("✅ Schemas are already in sync - no changes needed")
		return nil
	}

	// Show what will be changed
	fmt.Println("🔄 Preparing to sync schemas...")
	fmt.Println()
	
	totalChanges := len(comparison.Differences.MissingTables) +
		len(comparison.Differences.MissingViews) +
		len(comparison.Differences.MissingIndexes)
	
	fmt.Printf("Changes to apply: %d\n", totalChanges)
	
	if len(comparison.Differences.MissingTables) > 0 {
		fmt.Println("  - Tables to create:", len(comparison.Differences.MissingTables))
	}
	if len(comparison.Differences.MissingViews) > 0 {
		fmt.Println("  - Views to create:", len(comparison.Differences.MissingViews))
	}
	if len(comparison.Differences.MissingIndexes) > 0 {
		fmt.Println("  - Indexes to create:", len(comparison.Differences.MissingIndexes))
	}
	
	// Warn about extra items in Supabase
	if len(comparison.Differences.ExtraTables) > 0 ||
		len(comparison.Differences.ExtraViews) > 0 ||
		len(comparison.Differences.ExtraIndexes) > 0 {
		fmt.Println()
		fmt.Println("⚠️  Note: There are extra items in Supabase not in local schema.")
		fmt.Println("   These will NOT be removed. Run 'mage db:diff' to see details.")
	}

	fmt.Println()
	fmt.Print("Continue with sync? (y/N): ")
	
	var response string
	fmt.Scanln(&response)
	
	if strings.ToLower(response) != "y" && strings.ToLower(response) != "yes" {
		fmt.Println("Sync cancelled.")
		return nil
	}

	// Ensure migrations table exists
	fmt.Println("🔧 Ensuring migrations table exists...")
	err = EnsureMigrationsTable(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("failed to ensure migrations table: %w", err)
	}

	// Generate migration
	fmt.Println("📝 Generating migration...")
	migration, err := GenerateMigrationFromDiff(comparison.Differences, "schema_sync")
	if err != nil {
		return fmt.Errorf("failed to generate migration: %w", err)
	}

	// Save migration to file
	migrationFile, err := SaveMigrationToFile(migration)
	if err != nil {
		return fmt.Errorf("failed to save migration: %w", err)
	}
	fmt.Printf("   Migration saved to: %s\n", migrationFile)

	// Apply migration
	fmt.Println("🚀 Applying migration to Supabase...")
	err = ApplyMigration(ctx, databaseURL, migration)
	if err != nil {
		return fmt.Errorf("failed to apply migration: %w", err)
	}

	fmt.Println("✅ Schema sync completed successfully!")
	fmt.Printf("   Migration %s applied at %s\n", migration.Version, migration.AppliedAt.Format(time.RFC3339))
	
	// Verify sync
	fmt.Println()
	fmt.Println("🔍 Verifying sync...")
	return ShowStatus()
}