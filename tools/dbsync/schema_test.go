package dbsync

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseSchemaBasic(t *testing.T) {
	content := `
	-- Test schema
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		email TEXT DEFAULT '' NOT NULL
	);

	CREATE INDEX idx_users_email ON users(email);

	CREATE VIEW user_summary AS
	SELECT id, name FROM users;
	`

	schema, err := parseSchema(content)
	require.NoError(t, err)

	// Check tables
	assert.Len(t, schema.Tables, 1)
	assert.Equal(t, "users", schema.Tables[0].Name)
	assert.Len(t, schema.Tables[0].Columns, 3)

	// Check columns
	columns := schema.Tables[0].Columns
	assert.Equal(t, "id", columns[0].Name)
	assert.Equal(t, "TEXT", columns[0].Type)
	assert.True(t, columns[0].IsPrimaryKey)

	assert.Equal(t, "name", columns[1].Name)
	assert.True(t, columns[1].NotNull)

	assert.Equal(t, "email", columns[2].Name)
	assert.True(t, columns[2].NotNull)
	assert.NotNil(t, columns[2].DefaultValue)
	assert.Equal(t, "", *columns[2].DefaultValue)

	// Check views
	assert.Len(t, schema.Views, 1)
	assert.Equal(t, "user_summary", schema.Views[0].Name)

	// Check indexes
	assert.Len(t, schema.Indexes, 1)
	assert.Equal(t, "idx_users_email", schema.Indexes[0].Name)
	assert.Equal(t, "users", schema.Indexes[0].Table)
}

func TestRemoveComments(t *testing.T) {
	content := `
	-- This is a single line comment
	CREATE TABLE test (
		id INT, -- inline comment
		name TEXT
	);
	/* Multi-line
	   comment */
	CREATE INDEX test_idx ON test(id);
	`

	result := removeComments(content)

	// Should not contain comment text
	assert.NotContains(t, result, "This is a single line comment")
	assert.NotContains(t, result, "inline comment")
	assert.NotContains(t, result, "Multi-line")

	// Should still contain SQL
	assert.Contains(t, result, "CREATE TABLE test")
	assert.Contains(t, result, "CREATE INDEX test_idx")
}

func TestSplitStatements(t *testing.T) {
	content := `
	CREATE TABLE test1 (id INT);
	
	CREATE TABLE test2 (
		id INT,
		name TEXT
	);
	
	CREATE INDEX idx ON test1(id);
	`

	statements := splitStatements(content)

	assert.Len(t, statements, 3)
	assert.Contains(t, statements[0], "CREATE TABLE test1")
	assert.Contains(t, statements[1], "CREATE TABLE test2")
	assert.Contains(t, statements[2], "CREATE INDEX idx")
}

func TestCompareSchemas(t *testing.T) {
	local := &Schema{
		Tables: []Table{
			{Name: "users", Columns: []Column{{Name: "id", Type: "TEXT"}}},
			{Name: "posts", Columns: []Column{{Name: "id", Type: "TEXT"}}},
		},
		Views: []View{
			{Name: "user_summary", Definition: "SELECT * FROM users"},
		},
		Indexes: []Index{
			{Name: "idx_users_id", Table: "users"},
		},
	}

	remote := &Schema{
		Tables: []Table{
			{Name: "users", Columns: []Column{{Name: "id", Type: "TEXT"}}},
		},
		Views:   []View{},
		Indexes: []Index{},
	}

	comparison := CompareSchemas(local, remote)

	assert.False(t, comparison.InSync)
	assert.Len(t, comparison.Differences.MissingTables, 1)
	assert.Equal(t, "posts", comparison.Differences.MissingTables[0].Name)
	assert.Len(t, comparison.Differences.MissingViews, 1)
	assert.Equal(t, "user_summary", comparison.Differences.MissingViews[0].Name)
	assert.Len(t, comparison.Differences.MissingIndexes, 1)
	assert.Equal(t, "idx_users_id", comparison.Differences.MissingIndexes[0].Name)
}

func TestParseColumnDefinition(t *testing.T) {
	tests := []struct {
		input    string
		expected Column
	}{
		{
			input: "id TEXT PRIMARY KEY",
			expected: Column{
				Name:         "id",
				Type:         "TEXT",
				IsPrimaryKey: true,
				NotNull:      false,
				DefaultValue: nil,
			},
		},
		{
			input: "name TEXT NOT NULL",
			expected: Column{
				Name:         "name",
				Type:         "TEXT",
				IsPrimaryKey: false,
				NotNull:      true,
				DefaultValue: nil,
			},
		},
		{
			input: "status TEXT DEFAULT 'active' NOT NULL",
			expected: Column{
				Name:         "status",
				Type:         "TEXT",
				IsPrimaryKey: false,
				NotNull:      true,
				DefaultValue: stringPtr("active"),
			},
		},
	}

	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			column, err := parseColumnDefinition(test.input)
			require.NoError(t, err)

			assert.Equal(t, test.expected.Name, column.Name)
			assert.Equal(t, test.expected.Type, column.Type)
			assert.Equal(t, test.expected.IsPrimaryKey, column.IsPrimaryKey)
			assert.Equal(t, test.expected.NotNull, column.NotNull)

			if test.expected.DefaultValue == nil {
				assert.Nil(t, column.DefaultValue)
			} else {
				require.NotNil(t, column.DefaultValue)
				assert.Equal(t, *test.expected.DefaultValue, *column.DefaultValue)
			}
		})
	}
}

func stringPtr(s string) *string {
	return &s
}
