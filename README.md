# Wedding AI Photo Finder

An AI-powered web application that allows wedding guests to find all their photos from an event simply by uploading a selfie. The system uses facial recognition and vector similarity search to match faces in milliseconds.

## ✨ Features

- **Event Management**: Create separate events (e.g., "Wedding", "Reception") to organize photos.
- **Bulk Upload**: Admins can upload thousands of event photos which are processed in the background.
- **AI Processing**: Automatically detects faces and generates 512-dimensional embeddings using `InsightFace`.
- **Vector Search**: Uses PostgreSQL `pgvector` for ultra-fast cosine similarity searching.
- **Privacy-Focused**: Guests only see photos they appear in.
- **Self-Hosted**: Images are stored in your google drive.


## 🛠️ Tech Stack

### Frontend
- **Framework**: Next.js 14 (React)
- **Styling**: Tailwind CSS
- **HTTP Client**: Axios

### Backend & AI
- **API**: FastAPI (Python)
- **Face Recognition**: InsightFace (Buffalo_L model)
- **Image Processing**: OpenCV, NumPy
- **Task Queue**: Celery + Redis (for background photo indexing)

### Database & Infrastructure
- **Database**: PostgreSQL 16 + `pgvector` extension
- **Containerization**: Docker & Docker Compose
- **CI/CD**: GitHub Actions & GitHub Container Registry (GHCR)
- **Reverse Proxy**: Caddy (Automatic HTTPS)
- **Hosting**: DigitalOcean Droplet

---

## 🚀 Production Deployment Guide

This project is configured for automated Continuous Deployment (CD) to a DigitalOcean Droplet using GitHub Actions.

### Step 1: Server Preparation
SSH into your Ubuntu Droplet and install Docker. Then, prepare the necessary network and storage directories:
```bash
# Create a custom Docker network for container communication
docker network create sharememories_net

# Create application directories
mkdir -p /opt/ShareMemories/storage
mkdir -p /opt/caddy
```

### Step 2: Configure Environment Variables
Create your environment file on the server at `/opt/ShareMemories/.env`:
```bash
nano /opt/ShareMemories/.env
```
Populate it with your secrets:
```env
DATABASE_URL="postgresql://admin:postgres%40admin@wedding_db:5432/wedding_db"
REDIS_URL="redis://wedding_redis:6379/0"
ADMIN_PASSWORD="YourSecurePassword123"
APP_SECRET_KEY="your-random-secret-key"
GOOGLE_CREDENTIALS_JSON='{...}'
```

### Step 3: Start Stateful Services (Database & Redis)
Stateful services are run manually once, so they are never destroyed by the CI/CD pipeline.
```bash
# Start PostgreSQL
docker run -d \
  --name wedding_db \
  --network sharememories_net \
  --restart always \
  -e POSTGRES_USER=admin \
  -e POSTGRES_PASSWORD=postgres@admin \
  -e POSTGRES_DB=wedding_db \
  -v sharememories_postgres_data:/var/lib/postgresql/data \
  pgvector/pgvector:pg16

# Start Redis
docker run -d \
  --name wedding_redis \
  --network sharememories_net \
  --restart always \
  redis:alpine
```

**Step 2: Update the .env file with your values**

Edit `.env` and configure the following variables:

#### Database Configuration
```env
# PostgreSQL credentials (used by Docker Compose)
POSTGRES_USER=admin                          # Database username
POSTGRES_PASSWORD=postgres@admin             # Database password
POSTGRES_PASSWORD_ENCODED=postgres%40admin  # URL-encoded version of password
POSTGRES_DB=wedding_db                       # Database name
```

#### Backend Configuration
```env
# Google Cloud credentials (optional, for cloud storage integration)
GOOGLE_CREDENTIALS_JSON='...'

# Admin password for the admin panel
ADMIN_PASSWORD=YourSecurePassword123

# Secret key for JWT tokens and sessions (generate a random string)
APP_SECRET_KEY=your-secret-key-here

# Frontend URL (for CORS configuration)
FRONTEND_URL=http://localhost:3000          # For development
```

#### Frontend Configuration
```env
# Backend API URL accessible from the browser
NEXT_PUBLIC_API_URL=http://localhost:8000   # For development
```

### Important Notes

⚠️ **Security Warning**: 
- Never commit the `.env` file to version control (it's in `.gitignore`)
- Use strong, random values for `ADMIN_PASSWORD` and `APP_SECRET_KEY`
- Rotate credentials regularly in production

### Generating a Secure Secret Key

```bash
# On Linux/Mac:
python3 -c "import secrets; print(secrets.token_hex(32))"

# Or using OpenSSL:
openssl rand -hex 32
```

### URL Configuration for Different Environments

**Local Development:**
```env
FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## ⚡ Quick Start

1. **Environment Setup**
 
2. **Start the Application**
   Run the entire stack with Docker Compose:
   ```bash
   docker-compose up --build
   ```
   *Note: The first run will take a few minutes to download the AI models (~300MB).*

3. **Access the Interfaces**
   - **Frontend (User & Admin)**: http://localhost:3000
   - **Backend API Docs**: http://localhost:8000/docs

## 📖 How to Use

### 1. Admin Workflow (Setup Event)
1. Navigate to the **Admin Page**: http://localhost:3000/admin.
2. **Create Event**: Enter an event name (e.g., "Rohan & Priya Wedding") and click Create. Copy the **Event ID**.
3. **Upload Photos**:
   - Select the Event ID created above.
   - Choose a folder of raw images from the wedding.
   - Click **Upload**.
   - *Behind the scenes: The system saves images and queues them for AI indexing.*

### 2. Guest Workflow (Find Photos)
1. Navigate to the **Home Page**: http://localhost:3000.
2. **Upload Selfie**: Click "Choose selfie" or use the file picker.
3. Click **Find My Photos**.
4. The system will display a gallery of all photos where the guest appears.

## 🧪 Running Tests

An automated Python script is included to verify the entire pipeline (Event Creation -> Upload -> AI Indexing -> Search).

1. Place a test image named `test_face.jpg` in the project root.
2. Run the test script:
   ```bash
   pip install requests
   python test.py
   ```

## 📂 Project Structure

```
wedding-ai/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI endpoints
│   │   ├── worker.py        # Celery background tasks (AI)
│   │   ├── models.py        # SQLAlchemy Database Models
│   │   ├── schemas.py       # Pydantic Schemas
│   │   └── database.py      # DB Connection
│   └── Dockerfile
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Guest Search UI
│   │   └── admin/
│   │       └── page.tsx     # Admin Upload UI
│   └── next.config.mjs
├── storage/                 # Local storage for uploaded photos
├── .env                     # Environment configuration
├── docker-compose.yml       # Infrastructure orchestration
└── README.md
```

## 🔧 Troubleshooting

- **Uploads hanging?**
  - Ensure you are accessing the site via `localhost` or `127.0.0.1`.
  - Check Docker logs: `docker-compose logs -f backend`.

- **No matches found?**
  - Ensure the worker has finished processing. Check: `docker-compose logs -f worker`.
  - Face detection depends on clear lighting and visibility.

- **System Reset**
  - To clear all data and start fresh, run:
    ```bash
    curl -X DELETE http://localhost:8000/reset
    ```

    - **Create Backup**
  - To create a backup of the database and application, run:
    ```bash
    chmod +x complete_migration.sh
    ./complete_migration.sh


    # Create a folder for the project and extract the contents
    mkdir ShareMemories
    tar -xzvf sharememories_migration_*.tar.gz -C ShareMemories
    cd ShareMemories

    docker-compose up -d db redis

    # The SQL dump was packed inside the tarball, we can pipe it directly into the new db container
    cat wedding_db_backup.sql | docker exec -i wedding_db psql -U admin -d wedding_db

    # Build and start the backend, worker, and frontend
    docker-compose up -d --build

    ```


    - **Caddy setup**

    mkdir -p /opt/caddy
    nano /opt/caddy/Caddyfile

      sharememories.app {
          reverse_proxy wedding_frontend:3000
      }

      api.sharememories.app {
          reverse_proxy wedding_api:8000
      }


    docker run -d \
      --name caddy \
      --restart unless-stopped \
      --network sharememories_net \
      -p 80:80 \
      -p 443:443 \
      -v /opt/caddy/Caddyfile:/etc/caddy/Caddyfile \
      -v caddy_data:/data \
      -v caddy_config:/config \
      caddy:2

  
  <!-- application postgres db -->

  docker run -d \
  --name wedding_db \
  --network sharememories_net \
  --restart always \
  -e POSTGRES_USER=admin \
  -e POSTGRES_PASSWORD=postgres@admin \
  -e POSTGRES_DB=wedding_db \
  -v sharememories_postgres_data:/var/lib/postgresql/data \
  pgvector/pgvector:pg16

  <!-- APPLICATION REDIS  -->

  docker run -d \
  --name wedding_redis \
  --network sharememories_net \
  --restart always \
  redis:alpine
