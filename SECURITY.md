# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version      | Supported          |
| ------------ | ------------------ |
| Latest       | :white_check_mark: |
| Latest - 1   | :white_check_mark: |
| Latest - 2   | :white_check_mark: |
| < Latest - 2 | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security vulnerability, please follow these steps:

### 1. **Do NOT** open a public issue

Security vulnerabilities should be reported privately to prevent exploitation.

### 2. Report the vulnerability

Please report security vulnerabilities by one of the following methods:

- **Preferred**: Open a [GitHub Security Advisory](https://github.com/your-org/docked/security/advisories/new)
- **Alternative**: Email security@your-domain.com (if configured)
- **Alternative**: Contact repository maintainers directly

### 3. Include the following information

- Type of vulnerability (e.g., XSS, SQL injection, authentication bypass)
- Full paths of source file(s) related to the vulnerability
- Location of the affected code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the vulnerability

### 4. Response timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - **Critical**: 24-48 hours
  - **High**: 3-7 days
  - **Medium**: 7-14 days
  - **Low**: Next release cycle

### 5. Disclosure policy

- We will acknowledge receipt of your report within 48 hours
- We will provide regular updates on the status of the vulnerability
- We will notify you when the vulnerability is fixed
- We will credit you in the security advisory (unless you prefer to remain anonymous)
- We will coordinate public disclosure after a fix is available

## Security Best Practices

### For Users

1. **Keep Docked updated**: Always use the latest stable version
2. **Secure your environment**: Use strong passwords and secure your Portainer instances
3. **Network security**: Run Docked behind a firewall and use HTTPS
4. **Regular backups**: Backup your database regularly
5. **Monitor logs**: Review application logs for suspicious activity

### For Developers

1. **Dependency updates**: Keep dependencies up to date
2. **Security scanning**: Run security scans before committing
3. **Code review**: All code changes require security review
4. **Secrets management**: Never commit secrets or credentials
5. **Input validation**: Always validate and sanitize user input

## Security Features

Docked includes the following security features:

- ✅ JWT-based authentication
- ✅ Password hashing with bcrypt
- ✅ Rate limiting for API endpoints
- ✅ Input validation and sanitization
- ✅ Security headers with Helmet
- ✅ CORS protection
- ✅ SQL injection prevention (parameterized queries)
- ✅ XSS protection
- ✅ CSRF protection (where applicable)

## Known Security Considerations

### Current Limitations

1. **SQLite Database**: The default SQLite database may not be suitable for high-concurrency production environments. Consider PostgreSQL or MySQL for production.

2. **Default Credentials**: Change the default admin password immediately after installation.

3. **No HTTPS by Default**: Docked does not include HTTPS by default. Use a reverse proxy (nginx, Traefik) for production deployments.

4. **Portainer Credentials**: Portainer credentials are stored in the database. Ensure database encryption at rest.

### Security Recommendations

1. **Production Deployment**:
   - Use PostgreSQL or MySQL instead of SQLite
   - Deploy behind a reverse proxy with HTTPS
   - Use environment variables for sensitive configuration
   - Enable database encryption at rest
   - Regularly rotate credentials

2. **Network Security**:
   - Restrict access to the application
   - Use firewall rules
   - Implement network segmentation
   - Monitor network traffic

3. **Monitoring**:
   - Set up log aggregation
   - Monitor for suspicious activity
   - Set up alerts for security events
   - Regular security audits

## Security Updates

Security updates are released as patch versions (e.g., 1.2.3 → 1.2.4) and are marked with the `security` label in the changelog.

Subscribe to security advisories:

- Watch the repository for security advisories
- Subscribe to release notifications
- Monitor the CHANGELOG.md for security updates

## Security Acknowledgments

We thank the following individuals and organizations for responsibly disclosing security vulnerabilities:

<!-- Add acknowledgments here as vulnerabilities are reported -->

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [React Security](https://reactjs.org/docs/dom-elements.html#security)
- [Docker Security](https://docs.docker.com/engine/security/)

## Contact

For security-related questions or concerns, please contact:

- GitHub Security Advisories: [Create an advisory](https://github.com/your-org/docked/security/advisories/new)
- Repository Maintainers: @docked-maintainers

---

**Last Updated**: 2025-01-XX
