# Mysql2

## Rules

## Gotchyas

- [N4pJaP] mysql2 converts DATETIME/TIMESTAMP columns to JS Date objects by default (interpreted through the client's local timezone, then serialised as ISO-with-Z), which breaks consumers expecting raw `Y-m-d H:i:s` strings; pass dateStrings: true in the pool/connection options to keep the server's literal string shape

## Issues & Solutions
