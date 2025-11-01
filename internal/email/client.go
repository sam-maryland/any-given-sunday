package email

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/resend/resend-go/v2"
	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

// Client handles email sending via Resend
type Client struct {
	resendClient *resend.Client
	fromEmail    string
}

// NewClient creates a new email client with Resend integration
func NewClient(apiKey string, fromEmail string) (*Client, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("RESEND_API_KEY is required")
	}
	if fromEmail == "" {
		return nil, fmt.Errorf("FROM_EMAIL is required")
	}

	client := resend.NewClient(apiKey)

	return &Client{
		resendClient: client,
		fromEmail:    fromEmail,
	}, nil
}

// SendWeeklyRecap sends the weekly recap email to users with email addresses
// recipients: users to send emails to (must have email addresses)
// teamNames: map of UserID -> User with team names from Sleeper (for display in email)
func (c *Client) SendWeeklyRecap(ctx context.Context, summary *interactor.WeeklySummary, recipients []domain.User, teamNames domain.UserMap) error {
	if len(recipients) == 0 {
		log.Println("No users with email addresses found, skipping email sending")
		return nil
	}

	// Generate HTML content using team names for display
	htmlContent := GenerateWeeklyRecapHTML(summary, teamNames)

	// Generate subject line
	subject := fmt.Sprintf("🏈 Any Given Sunday: Week %d Recap", summary.Week)

	// Send email to each recipient
	// Rate limit: Resend allows 2 requests/second, so we wait 600ms between sends
	successCount := 0
	errorCount := 0

	for idx, user := range recipients {
		if user.Email == "" {
			continue
		}

		// Add rate limiting delay (except for first email)
		if idx > 0 {
			time.Sleep(600 * time.Millisecond) // Wait 600ms to stay under 2 req/sec limit
		}

		err := c.sendEmail(ctx, user.Email, subject, htmlContent)
		if err != nil {
			log.Printf("Failed to send email to %s (%s): %v", user.Name, user.Email, err)
			errorCount++
			continue
		}

		log.Printf("Successfully sent weekly recap email to %s (%s)", user.Name, user.Email)
		successCount++
	}

	log.Printf("Email sending complete: %d successful, %d failed", successCount, errorCount)

	// Return error only if all emails failed
	if errorCount > 0 && successCount == 0 {
		return fmt.Errorf("failed to send any emails (%d failures)", errorCount)
	}

	return nil
}

// sendEmail sends an individual email via Resend
func (c *Client) sendEmail(_ context.Context, toEmail string, subject string, htmlContent string) error {
	params := &resend.SendEmailRequest{
		From:    c.fromEmail,
		To:      []string{toEmail},
		Subject: subject,
		Html:    htmlContent,
	}

	_, err := c.resendClient.Emails.Send(params)
	if err != nil {
		return fmt.Errorf("resend API error: %w", err)
	}

	return nil
}
