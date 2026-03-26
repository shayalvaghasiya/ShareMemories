# Wedding AI Photo Finder

An AI-powered web application that allows wedding guests to find all their photos from an event simply by uploading a selfie. The system uses facial recognition and vector similarity search to match faces in milliseconds.

## 🚀 Features

- **Event Management**: Create separate events (e.g., "Wedding", "Reception") to organize photos.
- **Bulk Upload**: Admins can upload thousands of event photos which are processed in the background.
- **AI Processing**: Automatically detects faces and generates 512-dimensional embeddings using `InsightFace`.
- **Vector Search**: Uses PostgreSQL `pgvector` for ultra-fast cosine similarity searching.
- **Privacy-Focused**: Guests only see photos they appear in.
- **Self-Hosted**: Images and data stay on your local server.

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
- **Storage**: Local filesystem mapping

## 📋 Prerequisites

- Docker Desktop installed and running.

## ⚡ Quick Start

1. **Start the Application**
   Run the entire stack with Docker Compose:
   ```bash
   docker-compose up --build
   ```
   *Note: The first run will take a few minutes to download the AI models (~300MB).*

2. **Access the Interfaces**
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


    - **Caddy setip**

    mkdir -p /opt/caddy
    nano /opt/caddy/Caddyfile

      sharememories.app {
          reverse_proxy frontend:3000
      }

      api.sharememories.app {
          reverse_proxy backend:8000
      }


    docker run -d \
      --name caddy \
      --restart unless-stopped \
      --network sharememories_default \
      -p 80:80 \
      -p 443:443 \
      -v /opt/caddy/Caddyfile:/etc/caddy/Caddyfile \
      -v caddy_data:/data \
      -v caddy_config:/config \
      caddy:2

