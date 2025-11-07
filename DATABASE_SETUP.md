# Database Setup Documentation

## Overview

The application now uses SQLite database to store user credentials with bcrypt password hashing for security.

## Database Structure

### Users Table

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Security Features

1. **Password Hashing**: All passwords are hashed using bcrypt with 10 salt rounds
2. **No Plain Text Storage**: Passwords are never stored in plain text
3. **Password Validation**: Minimum 6 characters required
4. **Current Password Verification**: Users must provide current password to change it

## Database Location

- **File**: `server/db/users.db`
- **Directory**: `server/db/`

The database file is automatically created on first server start.

## Default User

On first run, a default admin user is created:
- **Username**: `admin`
- **Password**: `admin` (or value from `ADMIN_PASSWORD` env var)

**⚠️ IMPORTANT**: Change the default password immediately after first login!

## API Endpoints

### Public Endpoints
- `POST /api/auth/login` - User login
- `GET /api/auth/verify` - Verify token

### Protected Endpoints (require authentication)
- `GET /api/auth/me` - Get current user info
- `POST /api/auth/update-password` - Update password

## Password Update Process

1. User must provide current password
2. New password must be at least 6 characters
3. New password must be confirmed (match)
4. Password is hashed before storage
5. `updated_at` timestamp is updated

## Database Recommendations

### SQLite (Current)
- ✅ Simple setup, no additional server needed
- ✅ Good for single-instance deployments
- ✅ File-based, easy to backup
- ❌ Limited concurrent write performance
- ❌ Not ideal for high-traffic applications

### PostgreSQL (Recommended for Production)
- ✅ Excellent performance
- ✅ Supports concurrent connections
- ✅ Advanced features (transactions, constraints)
- ✅ Better for production environments
- ❌ Requires separate database server
- ❌ More complex setup

### MySQL (Alternative)
- ✅ Good performance
- ✅ Widely used
- ✅ Good documentation
- ❌ Requires separate database server
- ❌ More complex setup

## Migration to PostgreSQL (Future)

To migrate to PostgreSQL:

1. Install PostgreSQL and `pg` npm package
2. Update `server/db/database.js` to use PostgreSQL connection
3. Update SQL queries to PostgreSQL syntax
4. Run migration script to copy data from SQLite

## Backup Recommendations

1. **Regular Backups**: Backup `server/db/users.db` regularly
2. **Before Updates**: Always backup before updating the application
3. **Automated Backups**: Set up cron job or scheduled task for automatic backups

## Security Best Practices

1. ✅ Passwords are hashed with bcrypt
2. ✅ Passwords never stored in plain text
3. ✅ Minimum password length enforced
4. ✅ Current password required for changes
5. ⚠️ Consider adding password complexity requirements
6. ⚠️ Consider adding account lockout after failed attempts
7. ⚠️ Consider adding password expiration policies

