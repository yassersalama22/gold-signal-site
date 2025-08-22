# Aureus — Gold Signal (Static)

A lightweight, static website that fetches a daily gold-investment recommendation from S3 and displays short/mid/long-term BUY/WAIT guidance.

## Local run
```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Notes

No build step required (vanilla HTML/CSS/JS).

CI/CD to S3 via GitHub Actions + AWS OIDC will be added later.
EOF