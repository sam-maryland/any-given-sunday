package dbsync

import (
	"fmt"
	"os"
	"os/exec"
)

// VerifySchema verifies that the schema is in sync and SQLC can generate code
func VerifySchema() error {
	fmt.Println("🔍 Verifying database schema and SQLC integration...")
	fmt.Println()

	// Check if schemas are in sync
	fmt.Println("1. Checking schema synchronization...")
	err := ShowStatus()
	if err != nil {
		return fmt.Errorf("schema verification failed: %w", err)
	}

	// Check if sqlc.yaml exists
	if _, err := os.Stat("sqlc.yaml"); os.IsNotExist(err) {
		fmt.Println("⚠️  sqlc.yaml not found - skipping SQLC verification")
		return nil
	}

	// Try to generate SQLC code
	fmt.Println()
	fmt.Println("2. Verifying SQLC code generation...")
	cmd := exec.Command("sqlc", "generate")
	output, err := cmd.CombinedOutput()

	if err != nil {
		fmt.Printf("❌ SQLC generation failed:\n%s\n", string(output))
		return fmt.Errorf("SQLC verification failed: %w", err)
	}

	fmt.Println("✅ SQLC code generation successful")

	// Try to build the project
	fmt.Println()
	fmt.Println("3. Verifying Go compilation...")
	cmd = exec.Command("go", "build", "./...")
	output, err = cmd.CombinedOutput()

	if err != nil {
		fmt.Printf("❌ Go compilation failed:\n%s\n", string(output))
		return fmt.Errorf("Go compilation failed: %w", err)
	}

	fmt.Println("✅ Go compilation successful")

	fmt.Println()
	fmt.Println("🎉 All verifications passed! Schema and code are in sync.")

	return nil
}
