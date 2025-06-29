package dbsync

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/lib/pq" // PostgreSQL driver
)

// GetSupabaseSchema connects to Supabase and retrieves the current schema
func GetSupabaseSchema(ctx context.Context, databaseURL string) (*Schema, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	schema := &Schema{
		Tables:  make([]Table, 0),
		Views:   make([]View, 0),
		Indexes: make([]Index, 0),
	}

	// Get tables
	tables, err := getTables(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("failed to get tables: %w", err)
	}
	schema.Tables = tables

	// Get views
	views, err := getViews(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("failed to get views: %w", err)
	}
	schema.Views = views

	// Get indexes
	indexes, err := getIndexes(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("failed to get indexes: %w", err)
	}
	schema.Indexes = indexes

	return schema, nil
}

// getTables retrieves all tables and their columns from the database
func getTables(ctx context.Context, db *sql.DB) ([]Table, error) {
	// Get all tables in the public schema
	tablesQuery := `
		SELECT table_name 
		FROM information_schema.tables 
		WHERE table_schema = 'public' 
		AND table_type = 'BASE TABLE'
		ORDER BY table_name
	`

	rows, err := db.QueryContext(ctx, tablesQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []Table
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			return nil, err
		}

		// Get columns for this table
		columns, err := getTableColumns(ctx, db, tableName)
		if err != nil {
			return nil, fmt.Errorf("failed to get columns for table %s: %w", tableName, err)
		}

		table := Table{
			Name:        tableName,
			Columns:     columns,
			Constraints: make([]Constraint, 0), // Constraints not currently used in schema comparison
		}

		tables = append(tables, table)
	}

	return tables, rows.Err()
}

// getTableColumns retrieves all columns for a specific table
func getTableColumns(ctx context.Context, db *sql.DB, tableName string) ([]Column, error) {
	columnsQuery := `
		SELECT 
			column_name,
			data_type,
			is_nullable,
			column_default
		FROM information_schema.columns 
		WHERE table_schema = 'public' 
		AND table_name = $1
		ORDER BY ordinal_position
	`

	rows, err := db.QueryContext(ctx, columnsQuery, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []Column
	for rows.Next() {
		var columnName, dataType, isNullable string
		var columnDefault sql.NullString

		if err := rows.Scan(&columnName, &dataType, &isNullable, &columnDefault); err != nil {
			return nil, err
		}

		column := Column{
			Name:         columnName,
			Type:         dataType,
			NotNull:      isNullable == "NO",
			DefaultValue: nil,
			IsPrimaryKey: isPrimaryKeyColumn(ctx, db, tableName, columnName),
		}

		if columnDefault.Valid {
			column.DefaultValue = &columnDefault.String
		}

		columns = append(columns, column)
	}

	return columns, rows.Err()
}

// isPrimaryKeyColumn checks if a column is part of the primary key
func isPrimaryKeyColumn(ctx context.Context, db *sql.DB, tableName, columnName string) bool {
	query := `
		SELECT COUNT(*)
		FROM information_schema.key_column_usage kcu
		JOIN information_schema.table_constraints tc
			ON kcu.constraint_name = tc.constraint_name
			AND kcu.table_schema = tc.table_schema
		WHERE tc.constraint_type = 'PRIMARY KEY'
			AND kcu.table_schema = 'public'
			AND kcu.table_name = $1
			AND kcu.column_name = $2
	`

	var count int
	err := db.QueryRowContext(ctx, query, tableName, columnName).Scan(&count)
	if err != nil {
		fmt.Printf("Error checking if column %s is a primary key in table %s: %v\n", columnName, tableName, err)
		return false
	}

	return count > 0
}

// getViews retrieves all views from the database
func getViews(ctx context.Context, db *sql.DB) ([]View, error) {
	viewsQuery := `
		SELECT 
			table_name,
			view_definition
		FROM information_schema.views 
		WHERE table_schema = 'public'
		ORDER BY table_name
	`

	rows, err := db.QueryContext(ctx, viewsQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var views []View
	for rows.Next() {
		var viewName, viewDefinition string
		if err := rows.Scan(&viewName, &viewDefinition); err != nil {
			return nil, err
		}

		view := View{
			Name:       viewName,
			Definition: viewDefinition,
		}

		views = append(views, view)
	}

	return views, rows.Err()
}

// getIndexes retrieves all indexes from the database
func getIndexes(ctx context.Context, db *sql.DB) ([]Index, error) {
	indexesQuery := `
		SELECT 
			indexname,
			tablename,
			indexdef
		FROM pg_indexes 
		WHERE schemaname = 'public'
		AND indexname NOT LIKE '%_pkey'  -- Exclude primary key indexes
		ORDER BY indexname
	`

	rows, err := db.QueryContext(ctx, indexesQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var indexes []Index
	for rows.Next() {
		var indexName, tableName, indexDef string
		if err := rows.Scan(&indexName, &tableName, &indexDef); err != nil {
			return nil, err
		}

		index := Index{
			Name:    indexName,
			Table:   tableName,
			Columns: parseIndexColumns(indexDef),
			Unique:  parseIndexUnique(indexDef),
		}

		indexes = append(indexes, index)
	}

	return indexes, rows.Err()
}

// extractIndexColumns extracts column names from a string containing a parenthesized list of columns
func extractIndexColumns(stmt string) []string {
	// Find the part between parentheses
	startParen := strings.Index(stmt, "(")
	endParen := strings.LastIndex(stmt, ")")
	
	if startParen == -1 || endParen == -1 || startParen >= endParen {
		return make([]string, 0)
	}
	
	columnsStr := stmt[startParen+1 : endParen]
	
	// Split by comma and clean up
	columns := make([]string, 0)
	for _, col := range strings.Split(columnsStr, ",") {
		col = strings.TrimSpace(col)
		// Remove any function calls or expressions, just get the column name
		if spaceIdx := strings.Index(col, " "); spaceIdx != -1 {
			col = col[:spaceIdx]
		}
		if col != "" {
			columns = append(columns, col)
		}
	}
	
	return columns
}

// parseIndexColumns extracts column names from PostgreSQL index definition
func parseIndexColumns(indexDef string) []string {
	return extractIndexColumns(indexDef)
}

// parseIndexUnique determines if an index is unique from its definition
func parseIndexUnique(indexDef string) bool {
	return strings.Contains(strings.ToUpper(indexDef), "UNIQUE INDEX")
}
