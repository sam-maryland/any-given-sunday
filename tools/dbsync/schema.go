package dbsync

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// ParseSchemaFile parses a schema.sql file and returns a Schema object
func ParseSchemaFile(filename string) (*Schema, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("failed to open schema file: %w", err)
	}
	defer file.Close()

	content := make([]string, 0)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		content = append(content, scanner.Text())
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("failed to read schema file: %w", err)
	}

	return parseSchema(strings.Join(content, "\n"))
}

// parseSchema parses SQL content and extracts schema information
func parseSchema(content string) (*Schema, error) {
	schema := &Schema{
		Tables:  make([]Table, 0),
		Views:   make([]View, 0),
		Indexes: make([]Index, 0),
	}

	// Remove comments and normalize whitespace
	content = removeComments(content)
	statements := splitStatements(content)

	for _, stmt := range statements {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}

		if err := parseStatement(stmt, schema); err != nil {
			return nil, fmt.Errorf("failed to parse statement: %w", err)
		}
	}

	return schema, nil
}

// removeComments removes SQL comments from content
func removeComments(content string) string {
	// Remove single-line comments
	singleLineComment := regexp.MustCompile(`--.*`)
	content = singleLineComment.ReplaceAllString(content, "")

	// Remove multi-line comments
	multiLineComment := regexp.MustCompile(`/\*[\s\S]*?\*/`)
	content = multiLineComment.ReplaceAllString(content, "")

	return content
}

// splitStatements splits SQL content into individual statements
func splitStatements(content string) []string {
	// Simple split on semicolons - this is basic and may need enhancement
	statements := strings.Split(content, ";")
	result := make([]string, 0)

	for _, stmt := range statements {
		stmt = strings.TrimSpace(stmt)
		if stmt != "" {
			result = append(result, stmt)
		}
	}

	return result
}

// parseStatement parses a single SQL statement and adds to schema
func parseStatement(stmt string, schema *Schema) error {
	stmt = strings.TrimSpace(stmt)
	stmtUpper := strings.ToUpper(stmt)

	switch {
	case strings.HasPrefix(stmtUpper, "CREATE TABLE"):
		return parseCreateTable(stmt, schema)
	case strings.HasPrefix(stmtUpper, "CREATE OR REPLACE VIEW"):
		return parseCreateView(stmt, schema)
	case strings.HasPrefix(stmtUpper, "CREATE VIEW"):
		return parseCreateView(stmt, schema)
	case strings.HasPrefix(stmtUpper, "CREATE INDEX"):
		return parseCreateIndex(stmt, schema)
	case strings.HasPrefix(stmtUpper, "CREATE UNIQUE INDEX"):
		return parseCreateIndex(stmt, schema)
	default:
		// Skip other statements (ALTER, INSERT, etc.)
		return nil
	}
}

// parseCreateTable parses a CREATE TABLE statement
func parseCreateTable(stmt string, schema *Schema) error {
	// Extract table name (handle IF NOT EXISTS, case insensitive)
	tableNameRegex := regexp.MustCompile(`(?i)CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(`)
	matches := tableNameRegex.FindStringSubmatch(stmt)
	if len(matches) < 2 {
		return fmt.Errorf("could not extract table name from: %s", stmt)
	}

	tableName := matches[1]
	table := Table{
		Name:        tableName,
		Columns:     make([]Column, 0),
		Constraints: make([]Constraint, 0),
	}

	// Extract column definitions (basic implementation)
	// This is a simplified parser - a full implementation would be more robust
	start := strings.Index(stmt, "(")
	end := strings.LastIndex(stmt, ")")
	if start == -1 || end == -1 {
		return fmt.Errorf("malformed CREATE TABLE statement: %s", stmt)
	}

	columnSection := stmt[start+1 : end]
	lines := strings.Split(columnSection, ",")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Skip constraints for now - focus on columns
		if strings.HasPrefix(strings.ToUpper(line), "CONSTRAINT") ||
			strings.HasPrefix(strings.ToUpper(line), "PRIMARY KEY") ||
			strings.HasPrefix(strings.ToUpper(line), "FOREIGN KEY") ||
			strings.HasPrefix(strings.ToUpper(line), "UNIQUE") {
			continue
		}

		column, err := parseColumnDefinition(line)
		if err != nil {
			fmt.Printf("Warning: Skipping problematic column definition '%s': %v\n", line, err)
			continue // Skip problematic column definitions for now
		}
		table.Columns = append(table.Columns, *column)
	}

	schema.Tables = append(schema.Tables, table)
	return nil
}

// parseColumnDefinition parses a column definition
func parseColumnDefinition(line string) (*Column, error) {
	parts := strings.Fields(line)
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid column definition: %s", line)
	}

	column := &Column{
		Name:         parts[0],
		Type:         parts[1],
		NotNull:      false,
		DefaultValue: nil,
		IsPrimaryKey: false,
	}

	lineUpper := strings.ToUpper(line)

	// Check for NOT NULL
	if strings.Contains(lineUpper, "NOT NULL") {
		column.NotNull = true
	}

	// Check for DEFAULT
	defaultRegex := regexp.MustCompile(`(?i)default\s+([^,\s]+)`)
	if matches := defaultRegex.FindStringSubmatch(line); len(matches) > 1 {
		defaultValue := strings.Trim(matches[1], "'\"")
		column.DefaultValue = &defaultValue
	}

	// Check for PRIMARY KEY
	if strings.Contains(lineUpper, "PRIMARY KEY") {
		column.IsPrimaryKey = true
	}

	return column, nil
}

// parseCreateView parses a CREATE VIEW statement
func parseCreateView(stmt string, schema *Schema) error {
	viewNameRegex := regexp.MustCompile(`(?i)CREATE (?:OR REPLACE )?VIEW\s+(\w+)`)
	matches := viewNameRegex.FindStringSubmatch(stmt)
	if len(matches) < 2 {
		return fmt.Errorf("could not extract view name from: %s", stmt)
	}

	view := View{
		Name:       matches[1],
		Definition: stmt,
	}

	schema.Views = append(schema.Views, view)
	return nil
}

// parseCreateIndex parses a CREATE INDEX statement
func parseCreateIndex(stmt string, schema *Schema) error {
	// Match patterns like: CREATE [UNIQUE] INDEX [IF NOT EXISTS] index_name ON table_name
	indexRegex := regexp.MustCompile(`(?i)CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?(\w+)\s+ON\s+(\w+)`)
	matches := indexRegex.FindStringSubmatch(stmt)
	if len(matches) < 3 {
		return fmt.Errorf("could not extract index information from: %s", stmt)
	}

	index := Index{
		Name:    matches[1],
		Table:   matches[2],
		Columns: parseIndexColumnsFromStatement(stmt),
		Unique:  strings.Contains(strings.ToUpper(stmt), "UNIQUE"),
	}

	schema.Indexes = append(schema.Indexes, index)
	return nil
}

// parseIndexColumnsFromStatement extracts column names from a CREATE INDEX statement
func parseIndexColumnsFromStatement(stmt string) []string {
	// Use the shared helper for consistency
	return extractIndexColumns(stmt)
}

// CompareSchemas compares two schemas and returns the differences
func CompareSchemas(local, remote *Schema) *SchemaComparison {
	diff := &SchemaDiff{
		MissingTables:  make([]Table, 0),
		ExtraTables:    make([]Table, 0),
		MissingViews:   make([]View, 0),
		ExtraViews:     make([]View, 0),
		MissingIndexes: make([]Index, 0),
		ExtraIndexes:   make([]Index, 0),
		TableDiffs:     make([]TableDiff, 0),
	}

	// Compare tables
	localTableMap := make(map[string]Table)
	for _, table := range local.Tables {
		localTableMap[table.Name] = table
	}

	remoteTableMap := make(map[string]Table)
	for _, table := range remote.Tables {
		remoteTableMap[table.Name] = table
	}

	// Find missing and extra tables
	for name, table := range localTableMap {
		if _, exists := remoteTableMap[name]; !exists {
			diff.MissingTables = append(diff.MissingTables, table)
		}
	}

	for name, table := range remoteTableMap {
		if _, exists := localTableMap[name]; !exists {
			diff.ExtraTables = append(diff.ExtraTables, table)
		}
	}

	// Compare views
	localViewMap := make(map[string]View)
	for _, view := range local.Views {
		localViewMap[view.Name] = view
	}

	remoteViewMap := make(map[string]View)
	for _, view := range remote.Views {
		remoteViewMap[view.Name] = view
	}

	for name, view := range localViewMap {
		if _, exists := remoteViewMap[name]; !exists {
			diff.MissingViews = append(diff.MissingViews, view)
		}
	}

	for name, view := range remoteViewMap {
		if _, exists := localViewMap[name]; !exists {
			diff.ExtraViews = append(diff.ExtraViews, view)
		}
	}

	// Compare indexes
	localIndexMap := make(map[string]Index)
	for _, index := range local.Indexes {
		localIndexMap[index.Name] = index
	}

	remoteIndexMap := make(map[string]Index)
	for _, index := range remote.Indexes {
		remoteIndexMap[index.Name] = index
	}

	for name, index := range localIndexMap {
		if _, exists := remoteIndexMap[name]; !exists {
			diff.MissingIndexes = append(diff.MissingIndexes, index)
		}
	}

	for name, index := range remoteIndexMap {
		if _, exists := localIndexMap[name]; !exists {
			diff.ExtraIndexes = append(diff.ExtraIndexes, index)
		}
	}

	// Determine if schemas are in sync
	inSync := len(diff.MissingTables) == 0 &&
		len(diff.ExtraTables) == 0 &&
		len(diff.MissingViews) == 0 &&
		len(diff.ExtraViews) == 0 &&
		len(diff.MissingIndexes) == 0 &&
		len(diff.ExtraIndexes) == 0 &&
		len(diff.TableDiffs) == 0

	return &SchemaComparison{
		LocalSchema:  local,
		RemoteSchema: remote,
		Differences:  diff,
		InSync:       inSync,
	}
}
