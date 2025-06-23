# Google Cloud Run Migration

## Overview

Migrate the current Discord bot deployment from Heroku to Google Cloud Run to improve cost efficiency, scalability, and infrastructure management.

## Current State Analysis

### Existing Heroku Setup
- **Service**: Discord bot worker (`worker: bin/commish-bot` in Procfile)
- **Architecture**: Single worker process for Discord bot
- **Dependencies**: Supabase PostgreSQL, Discord API, Sleeper API
- **Build**: Mage-based build system
- **CI/CD**: GitHub Actions for weekly recap only

### Missing Components
- Main Discord bot entry point (`cmd/commish-bot/main.go`)
- Docker containerization
- Health check endpoints
- Comprehensive CI/CD for main service

### Current Environment Variables
```
DATABASE_URL                    # Supabase PostgreSQL connection
DISCORD_TOKEN                  # Discord bot token
DISCORD_APP_ID                 # Discord application ID
DISCORD_GUILD_ID               # Target Discord server ID
DISCORD_WELCOME_CHANNEL_ID     # Channel for new member onboarding
DISCORD_WEEKLY_RECAP_CHANNEL_ID # Channel for weekly summaries
```

## Migration Plan

### Phase 1: Application Preparation

#### 1.1 Create Discord Bot Main Entry Point
- **File**: `cmd/commish-bot/main.go`
- **Purpose**: Initialize Discord bot with proper dependency injection
- **Requirements**:
  - Environment variable validation
  - Discord session initialization
  - Command registration
  - Graceful shutdown handling
  - Health check endpoint (for Cloud Run probes)

#### 1.2 Add Containerization (Optional for Source Deployment)
- **Source Deployment**: No Dockerfile needed (Cloud Build auto-detects Go)
- **Alternative Dockerfile**: Optional for local testing
  - **Base Image**: `golang:1.21-alpine` for build, `alpine:latest` for runtime  
  - **Build Process**: Use mage build system within container
- **Buildpacks**: Google Cloud Build uses buildpacks for Go applications automatically

#### 1.3 Add Health Checks
- **HTTP endpoint**: `/health` for Cloud Run health probes
- **Checks**: Database connectivity, Discord session status
- **Response format**: JSON with service status

### Phase 2: Google Cloud Infrastructure

#### 2.1 Cloud Run Configuration (Free Tier Focus)
- **Service Type**: Cloud Run (fully managed)
- **Scaling**: 
  - Min instances: 0 (cost optimization)
  - Max instances: 1 (Discord bot singleton)
  - Concurrency: 1000 (default)
- **Resources** (within free tier limits):
  - Memory: 512MB (free tier limit: 1GB)
  - CPU: 1 vCPU (free tier limit: 1 vCPU)
  - Request timeout: 300s (reasonable for Discord bot)
- **Free Tier Limits**:
  - 2 million requests/month
  - 400,000 GB-seconds/month
  - 200,000 vCPU-seconds/month

#### 2.2 Secret Management (GitHub Secrets Implementation)

**GitHub Repository Secrets**:
- `DATABASE_URL` - Supabase PostgreSQL connection string
- `DISCORD_TOKEN` - Discord bot token
- `GCP_SERVICE_ACCOUNT_KEY` - Google Cloud service account key for deployment
- **Cost**: $0/month
- **Security**: Encrypted in transit and at rest by GitHub
- **Access**: Only available during GitHub Actions workflows

**Cloud Run Environment Variables** (non-sensitive):
- `DISCORD_APP_ID` - Discord application ID
- `DISCORD_GUILD_ID` - Target Discord server ID
- `DISCORD_WELCOME_CHANNEL_ID` - Channel for new member onboarding
- `DISCORD_WEEKLY_RECAP_CHANNEL_ID` - Channel for weekly summaries

**Setup Process**:
1. Add secrets to GitHub repository: Settings → Secrets and variables → Actions
2. Create Google Cloud service account with minimal permissions
3. Download service account key as JSON and add to GitHub secrets
4. Deploy using GitHub Actions with secret injection

#### 2.3 IAM and Permissions (GitHub Secrets Deployment)

**Deployment Service Account** (for GitHub Actions):
- `Cloud Run Admin` - Deploy and manage Cloud Run services
- `Cloud Build Editor` - Use Cloud Build for source deployments
- `Service Account User` - Act as the runtime service account

**Runtime Service Account** (for the Discord bot):
- `Cloud Run Invoker` - For health checks
- `Logging Writer` - For Cloud Logging
- `Monitoring Metric Writer` - For basic metrics

**Service Account Key Setup**:
```bash
# Create deployment service account
gcloud iam service-accounts create discord-bot-deployer

# Grant necessary permissions
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:discord-bot-deployer@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

# Create and download key
gcloud iam service-accounts keys create key.json \
  --iam-account=discord-bot-deployer@PROJECT_ID.iam.gserviceaccount.com
```

### Phase 3: CI/CD Enhancement

#### 3.1 Deployment Options (Free Tier)

**Option 1: Source-Based Deployment (Recommended for Free Tier)**
- Deploy directly from source code (no container registry needed)
- Use `gcloud run deploy --source .` command
- Google Cloud Build handles containerization automatically
- **Cost**: Free (within Cloud Build free tier: 120 build-minutes/day)

**Option 2: Artifact Registry (Free Tier Alternative)**
- Use Artifact Registry instead of Container Registry
- **Free tier**: 0.5 GB storage per month
- Sufficient for small Discord bot containers

**GitHub Actions Workflow**: `.github/workflows/deploy-commish-bot.yml`
```yaml
name: Deploy Discord Bot to Cloud Run

on:
  push:
    branches: [ main ]
    paths:
      - 'cmd/commish-bot/**'
      - 'internal/**'
      - 'pkg/**'
      - '.github/workflows/deploy-commish-bot.yml'
  workflow_dispatch:

env:
  PROJECT_ID: your-gcp-project-id
  SERVICE_NAME: commish-bot
  REGION: us-central1

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Authenticate to Google Cloud
      uses: google-github-actions/auth@v1
      with:
        credentials_json: ${{ secrets.GCP_SERVICE_ACCOUNT_KEY }}

    - name: Set up Cloud SDK
      uses: google-github-actions/setup-gcloud@v1

    - name: Deploy to Cloud Run
      run: |
        gcloud run deploy $SERVICE_NAME \
          --source . \
          --region $REGION \
          --platform managed \
          --allow-unauthenticated \
          --memory 512Mi \
          --cpu 1 \
          --max-instances 1 \
          --min-instances 0 \
          --update-env-vars="DATABASE_URL=${{ secrets.DATABASE_URL }}" \
          --update-env-vars="DISCORD_TOKEN=${{ secrets.DISCORD_TOKEN }}" \
          --set-env-vars="DISCORD_APP_ID=${{ vars.DISCORD_APP_ID }}" \
          --set-env-vars="DISCORD_GUILD_ID=${{ vars.DISCORD_GUILD_ID }}" \
          --set-env-vars="DISCORD_WELCOME_CHANNEL_ID=${{ vars.DISCORD_WELCOME_CHANNEL_ID }}" \
          --set-env-vars="DISCORD_WEEKLY_RECAP_CHANNEL_ID=${{ vars.DISCORD_WEEKLY_RECAP_CHANNEL_ID }}"

    - name: Verify deployment
      run: |
        # Get the service URL
        SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)")
        echo "Service deployed to: $SERVICE_URL"
        
        # Basic health check (if health endpoint exists)
        # curl -f $SERVICE_URL/health || echo "Health check failed, but service may still be working"
```

**Enhanced Weekly Recap**: Update existing workflow
- No changes needed (runs independently via cron)
- Could potentially run as Cloud Run job in future

#### 3.2 Deployment Strategy
- **Blue/Green**: Cloud Run revisions for zero-downtime
- **Health Checks**: Automated rollback on failure
- **Traffic Splitting**: Gradual rollout capability

### Phase 4: Migration Execution

#### 4.1 Pre-Migration Checklist
- [ ] Discord bot main entry point implemented
- [ ] Dockerfile and containerization complete
- [ ] Google Cloud project setup
- [ ] Secret Manager configured with credentials
- [ ] CI/CD pipeline tested
- [ ] Health check endpoints functional

#### 4.2 Migration Steps
1. **Parallel Deployment**: Deploy to Cloud Run alongside Heroku
2. **Testing Phase**: Validate functionality in parallel environment
3. **Traffic Switch**: Update Discord application settings if needed
4. **Monitoring**: Observe metrics and logs for 24-48 hours
5. **Heroku Decommission**: Scale down and remove Heroku resources

#### 4.3 Rollback Plan
- **Cloud Run**: Revert to previous revision
- **Emergency**: Re-enable Heroku dynos
- **DNS/Config**: Restore original Discord application settings

## Benefits

### Cost Optimization
- **Pay-per-use**: Only charged when bot is actively processing
- **Scale-to-zero**: No charges during idle periods
- **No dyno hours**: Eliminate Heroku's fixed monthly costs

### Technical Improvements
- **Container-based**: Modern deployment with Docker
- **Auto-scaling**: Handles traffic spikes automatically
- **Integrated logging**: Better observability with Cloud Logging
- **Secret management**: More secure credential handling
- **Infrastructure as code**: Reproducible deployments

### Operational Benefits
- **Zero-downtime deployments**: Cloud Run revision system
- **Built-in monitoring**: Google Cloud Monitoring integration
- **Global distribution**: Multi-region deployment capability
- **Serverless management**: Reduced operational overhead

## Implementation Timeline

### Week 1: Application Preparation
- Create Discord bot main entry point
- Add Dockerfile and containerization
- Implement health check endpoints
- Test local Docker builds

### Week 2: Cloud Infrastructure
- Set up Google Cloud project and IAM
- Configure Secret Manager
- Create Cloud Run service configuration
- Test manual deployments

### Week 3: CI/CD Pipeline
- Implement GitHub Actions workflows
- Test automated deployments
- Set up monitoring and alerting
- Document deployment process

### Week 4: Migration & Validation
- Parallel deployment testing
- Performance and functionality validation
- Production traffic migration
- Heroku decommission

## Cost Analysis (Free Tier Focus)

### Current Heroku Costs
- **Dyno**: $7/month (Eco dyno) or $25/month (Basic dyno)
- **Add-ons**: Varies based on usage

### Projected Google Cloud Costs (GitHub Secrets Implementation)
- **Cloud Run**: $0/month (within free tier limits)
  - Discord bot usage well under 400,000 GB-seconds/month
  - Minimal requests (Discord uses webhooks, not continuous HTTP)
- **Cloud Build**: $0/month (within 120 build-minutes/day limit)
- **Secret Management**: $0/month (using GitHub Secrets)
  - Secrets stored and encrypted by GitHub for free
  - No Google Cloud secret storage costs
- **Networking**: $0/month (egress within free tier)
- **Storage**: $0/month (no container registry needed with source deployment)
- **IAM/Service Accounts**: $0/month (included in free tier)

**Total projected cost**: $0/month
**Estimated savings**: 100% cost reduction (from $7-25/month to $0)

**GitHub Setup Requirements**:
1. **Repository Secrets** (Settings → Secrets and variables → Actions):
   - `DATABASE_URL` - Your Supabase connection string
   - `DISCORD_TOKEN` - Your Discord bot token
   - `GCP_SERVICE_ACCOUNT_KEY` - Service account JSON key for deployment

2. **Repository Variables** (Settings → Secrets and variables → Actions):
   - `DISCORD_APP_ID` - Discord application ID
   - `DISCORD_GUILD_ID` - Your Discord server ID
   - `DISCORD_WELCOME_CHANNEL_ID` - Welcome channel ID
   - `DISCORD_WEEKLY_RECAP_CHANNEL_ID` - Weekly recap channel ID

## Risks and Mitigation

### Technical Risks
- **Discord session management**: Ensure proper reconnection handling
- **Container startup time**: Optimize for fast cold starts
- **Memory limits**: Monitor and adjust resource allocation

### Operational Risks
- **Deployment failures**: Comprehensive testing and rollback procedures
- **Secret management**: Secure migration of credentials
- **Monitoring gaps**: Establish proper alerting before migration

### Business Risks
- **Service downtime**: Parallel deployment strategy
- **Feature regression**: Thorough testing phase
- **Cost overruns**: Monitor usage patterns closely

## Success Metrics

### Technical Metrics
- **Uptime**: >99.9% availability
- **Response time**: <100ms for Discord interactions
- **Cold start time**: <5 seconds
- **Memory usage**: <512MB average

### Business Metrics
- **Cost reduction**: >50% compared to Heroku
- **Deployment frequency**: Faster, automated deployments
- **Incident resolution**: Improved observability and debugging

## Future Enhancements

### Post-Migration Improvements
- **Multi-region deployment**: Global distribution for better latency
- **Cloud Run Jobs**: Migrate weekly recap from GitHub Actions
- **Cloud SQL**: Consider managed PostgreSQL if moving away from Supabase
- **Cloud Functions**: Break down into microservices if needed

### Monitoring and Observability
- **Custom metrics**: Discord-specific monitoring
- **Alerting**: Proactive notification of issues
- **Log analysis**: Structured logging for better insights
- **Performance optimization**: Continuous improvement based on metrics

## Documentation and Handoff

### Required Documentation
- [ ] Cloud Run deployment guide
- [ ] Secret management procedures
- [ ] Monitoring and alerting setup
- [ ] Troubleshooting runbook
- [ ] Cost monitoring and optimization guide

### Knowledge Transfer
- [ ] Google Cloud console access
- [ ] CI/CD pipeline understanding
- [ ] Container registry management
- [ ] Secret rotation procedures

---

**Status**: Planning
**Owner**: TBD
**Estimated Effort**: 2-3 weeks
**Priority**: Medium
**Dependencies**: None