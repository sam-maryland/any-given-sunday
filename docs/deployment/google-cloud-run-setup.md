# Google Cloud Run Deployment Setup

This guide walks you through setting up the Discord bot to deploy automatically to Google Cloud Run using GitHub Actions and GitHub Secrets.

## Prerequisites

- Google Cloud Platform account with billing enabled
- GitHub repository with admin access
- Discord bot token and application credentials

## Step 1: Google Cloud Project Setup

### 1.1 Create or Select Project
```bash
# Create new project (optional)
gcloud projects create your-project-id --name="Fantasy Football Bot"

# Set active project
gcloud config set project your-project-id
```

### 1.2 Enable Required APIs
```bash
# Enable Cloud Run API
gcloud services enable run.googleapis.com

# Enable Cloud Build API (for source deployments)
gcloud services enable cloudbuild.googleapis.com

# Enable Container Registry API (if needed)
gcloud services enable containerregistry.googleapis.com
```

### 1.3 Create Service Account for Deployment
```bash
# Create deployment service account
gcloud iam service-accounts create discord-bot-deployer \
    --description="Service account for deploying Discord bot to Cloud Run" \
    --display-name="Discord Bot Deployer"

# Grant necessary permissions
gcloud projects add-iam-policy-binding your-project-id \
    --member="serviceAccount:discord-bot-deployer@your-project-id.iam.gserviceaccount.com" \
    --role="roles/run.admin"

gcloud projects add-iam-policy-binding your-project-id \
    --member="serviceAccount:discord-bot-deployer@your-project-id.iam.gserviceaccount.com" \
    --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding your-project-id \
    --member="serviceAccount:discord-bot-deployer@your-project-id.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"

# Create and download service account key
gcloud iam service-accounts keys create discord-bot-key.json \
    --iam-account=discord-bot-deployer@your-project-id.iam.gserviceaccount.com
```

**Important**: Download and securely store the `discord-bot-key.json` file. You'll need its contents for GitHub Secrets.

## Step 2: GitHub Repository Configuration

### 2.1 Add Repository Secrets
Go to your repository: **Settings** → **Secrets and variables** → **Actions**

Add the following **Repository Secrets**:

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `GCP_SERVICE_ACCOUNT_KEY` | Contents of `discord-bot-key.json` | `{"type": "service_account", ...}` |
| `DATABASE_URL` | Supabase PostgreSQL connection string | `postgresql://postgres:[password]@...` |
| `DISCORD_TOKEN` | Discord bot token | `MTIzNDU2Nzg5MDEyMzQ1Njc4OTA...` |

### 2.2 Add Repository Variables
Add the following **Repository Variables**:

| Variable Name | Description | Example Value |
|---------------|-------------|---------------|
| `GCP_PROJECT_ID` | Your Google Cloud project ID | `fantasy-football-bot-12345` |
| `DISCORD_APP_ID` | Discord application ID | `1234567890123456789` |
| `DISCORD_GUILD_ID` | Your Discord server ID | `9876543210987654321` |
| `DISCORD_WELCOME_CHANNEL_ID` | Welcome channel ID | `1111111111111111111` |
| `DISCORD_WEEKLY_RECAP_CHANNEL_ID` | Weekly recap channel ID | `2222222222222222222` |

### 2.3 Verify Workflow File
Ensure `.github/workflows/deploy-commish-bot.yml` exists and is properly configured with your project settings.

## Step 3: Initial Deployment

### 3.1 Trigger First Deployment
1. Push changes to the `main` branch, OR
2. Go to **Actions** tab → **Deploy Discord Bot to Cloud Run** → **Run workflow**

### 3.2 Monitor Deployment
1. Watch the GitHub Actions workflow progress
2. Check Cloud Run console: https://console.cloud.google.com/run
3. Verify health check endpoint: `https://[service-url]/health`

## Step 4: Verify Discord Bot Functionality

### 4.1 Check Discord Bot Status
1. Ensure bot appears online in your Discord server
2. Test slash commands: `/standings`, `/career-stats`, `/weekly-summary`
3. Monitor Cloud Run logs for any errors

### 4.2 Monitor Resources
- **Memory usage**: Should be under 512MB
- **CPU usage**: Minimal when idle
- **Requests**: Mainly health checks and Discord events

## Step 5: Cost Optimization

### 5.1 Verify Free Tier Usage
- **Cloud Run**: 2M requests/month, 400K GB-seconds/month (free)
- **Cloud Build**: 120 build-minutes/day (free)
- **Networking**: 1GB North America egress/month (free)

### 5.2 Set Billing Alerts (Optional)
```bash
# Create billing budget alert
gcloud billing budgets create \
    --billing-account=[BILLING_ACCOUNT_ID] \
    --display-name="Discord Bot Budget" \
    --budget-amount=1.00 \
    --threshold-rules-percent=50,90,100
```

## Troubleshooting

### Common Issues

#### 1. **"Permission denied" during deployment**
- Verify service account has correct IAM roles
- Check that `GCP_SERVICE_ACCOUNT_KEY` secret contains valid JSON

#### 2. **"Service not found" error**
- Ensure Cloud Run API is enabled
- Verify project ID in GitHub variables

#### 3. **Health check failures**
- Check Discord bot connection in Cloud Run logs
- Verify database connectivity
- Ensure all environment variables are set correctly

#### 4. **Discord bot not responding**
- Check bot token validity
- Verify Discord application permissions
- Review Cloud Run service logs

### Debugging Commands

```bash
# View Cloud Run service details
gcloud run services describe commish-bot --region=us-central1

# View recent logs
gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=commish-bot" --limit=50

# Test health endpoint
curl https://[service-url]/health
```

## Maintenance

### Updating the Bot
1. Push changes to `main` branch
2. GitHub Actions automatically deploys updates
3. Zero-downtime deployment with Cloud Run revisions

### Monitoring
- **GitHub Actions**: Monitor deployment status
- **Cloud Run Console**: View service metrics and logs  
- **Discord**: Verify bot functionality

### Scaling (if needed)
```bash
# Increase max instances if needed
gcloud run services update commish-bot \
    --region=us-central1 \
    --max-instances=3
```

## Security Best Practices

1. **Rotate service account keys** periodically
2. **Monitor API usage** in Google Cloud Console
3. **Review IAM permissions** regularly
4. **Keep Discord tokens secure** in GitHub Secrets
5. **Enable Cloud Audit Logs** for production environments

## Support

- **Google Cloud Run Documentation**: https://cloud.google.com/run/docs
- **GitHub Actions Documentation**: https://docs.github.com/en/actions
- **Discord.js Documentation**: https://discord.js.org/

For project-specific issues, check the repository's issue tracker.