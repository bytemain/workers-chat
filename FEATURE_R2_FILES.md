# File and Image Upload Feature

This chat application now supports sending files and images using CloudFlare R2 storage.

## Features

- **File Upload**: Upload any file type (images, PDFs, documents, etc.)
- **Image Preview**: Images are displayed inline in the chat with a preview
- **File Size Limit**: Maximum file size is 10MB
- **Rate Limiting**: File uploads are subject to the same rate limiting as messages
- **Persistent Storage**: Files are stored in CloudFlare R2 with long-term caching
- **Security**: Each file is assigned a unique UUID-based key

## How to Use

### For End Users

1. **Upload a File**:
   - Click the 📎 (paperclip) button at the bottom right of the chat window
   - Select a file from your device
   - Wait for the upload to complete
   - The file will be shared in the chat room

2. **View Files**:
   - **Images**: Display inline with a preview (max 300x300px)
   - **Other Files**: Show as clickable download links with a 📎 icon

### For Developers

#### Prerequisites

Before deploying, you need to create an R2 bucket:

```bash
# Create the R2 bucket (only needs to be done once)
wrangler r2 bucket create chat-files
```

#### Configuration

The R2 bucket is configured in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "CHAT_FILES"
bucket_name = "chat-files"
```

#### API Endpoints

**File Upload**:
- **Endpoint**: `POST /api/room/{roomname}/upload`
- **Content-Type**: `multipart/form-data`
- **Form Field**: `file`
- **Response**: JSON with file URL and metadata

Example response:
```json
{
  "success": true,
  "fileUrl": "/files/{uuid}.{ext}",
  "fileName": "example.jpg",
  "fileType": "image/jpeg",
  "fileSize": 123456
}
```

**File Retrieval**:
- **Endpoint**: `GET /files/{fileKey}`
- **Response**: File content with appropriate Content-Type headers
- **Caching**: Files are cached for 1 year

#### Message Protocol

Files are represented in the message protocol as:
```
FILE:{fileUrl}|{fileName}|{fileType}
```

Example:
```
FILE:/files/a1b2c3d4-1234-5678-90ab-cdef12345678.jpg|vacation.jpg|image/jpeg
```

## Technical Implementation

### Backend (chat.mjs)

1. **File Upload Handler** (`/upload` endpoint in ChatRoom):
   - Validates file size (10MB max)
   - Applies rate limiting
   - Generates unique UUID-based filename
   - Uploads to R2 with proper content-type metadata

2. **File Retrieval Handler** (`/files/*` route):
   - Fetches files from R2
   - Returns files with appropriate HTTP headers
   - Includes caching headers for performance

3. **Message Protocol Extension**:
   - File messages start with "FILE:" prefix
   - No length restriction for file messages (unlike text messages)

### Frontend (chat.html)

1. **UI Components**:
   - File input button (📎) styled and positioned
   - Hidden file input element
   - Accepts: `image/*,application/pdf,.doc,.docx,.txt`

2. **Upload Logic**:
   - Creates FormData with selected file
   - POSTs to upload endpoint
   - Handles success and error responses
   - Sends file message through WebSocket

3. **Display Logic**:
   - Detects "FILE:" prefix in messages
   - For images: Creates `<img>` tag with preview
   - For other files: Creates download link with 📎 icon
   - Click on images opens in new tab

## Limitations

- Maximum file size: 10MB
- Rate limiting applies (same as regular messages)
- Files are public once uploaded (anyone with the URL can access)
- No file deletion functionality (files persist indefinitely)

## Future Enhancements

Possible improvements for the future:
- File deletion/management
- Private file sharing with authentication
- Larger file size support
- File type validation on backend
- Thumbnail generation for images
- Progress bar for large uploads
- Drag-and-drop file upload
- Multiple file selection
