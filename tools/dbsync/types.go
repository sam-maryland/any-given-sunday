package dbsync

import "time"

// Schema represents a database schema with all its components
type Schema struct {
	Tables  []Table
	Views   []View
	Indexes []Index
}

// Table represents a database table
type Table struct {
	Name        string
	Columns     []Column
	Constraints []Constraint
}

// Column represents a table column
type Column struct {
	Name         string
	Type         string
	NotNull      bool
	DefaultValue *string
	IsPrimaryKey bool
}

// Constraint represents a table constraint
type Constraint struct {
	Name       string
	Type       string // PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK
	Columns    []string
	Definition string
}

// View represents a database view
type View struct {
	Name       string
	Definition string
}

// Index represents a database index
type Index struct {
	Name    string
	Table   string
	Columns []string
	Unique  bool
}

// SchemaDiff represents differences between two schemas
type SchemaDiff struct {
	MissingTables  []Table
	ExtraTables    []Table
	MissingViews   []View
	ExtraViews     []View
	MissingIndexes []Index
	ExtraIndexes   []Index
	TableDiffs     []TableDiff
}

// TableDiff represents differences in a specific table
type TableDiff struct {
	Name           string
	MissingColumns []Column
	ExtraColumns   []Column
	ColumnDiffs    []ColumnDiff
}

// ColumnDiff represents differences in a specific column
type ColumnDiff struct {
	Name           string
	TypeChanged    bool
	OldType        string
	NewType        string
	NullChanged    bool
	OldNotNull     bool
	NewNotNull     bool
	DefaultChanged bool
	OldDefault     *string
	NewDefault     *string
}

// Migration represents a database migration
type Migration struct {
	Version   string
	Name      string
	UpSQL     string
	DownSQL   string
	Checksum  string
	AppliedAt *time.Time
}

// SchemaComparison contains the result of comparing two schemas
type SchemaComparison struct {
	LocalSchema  *Schema
	RemoteSchema *Schema
	Differences  *SchemaDiff
	InSync       bool
}
