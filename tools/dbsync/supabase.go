package dbsync

import (
	"context"
	"database/sql"
	"fmt"

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
			Constraints: make([]Constraint, 0), // TODO: implement constraints
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
			IsPrimaryKey: false, // TODO: check for primary key
		}

		if columnDefault.Valid {
			column.DefaultValue = &columnDefault.String
		}

		columns = append(columns, column)
	}

	return columns, rows.Err()
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
			Columns: make([]string, 0), // TODO: parse columns from indexDef
			Unique:  false,             // TODO: determine if unique from indexDef
		}

		indexes = append(indexes, index)
	}

	return indexes, rows.Err()
}