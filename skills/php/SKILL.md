---
name: php
description: PHP 8.2+ with strict types, Composer, PSR-4/PSR-12, and modern patterns. Use when writing or editing .php files, working with composer.json, Laravel, Symfony, or PSR-compliant code.
---

# Php

- Use PHP 8.2+ - typed properties, enums, match expressions, named arguments.
- Declare strict types: `declare(strict_types=1);` at the top of every file.
- Use Composer for dependency management: `composer.json` + `composer.lock` committed.
- PSR-4 autoloading and PSR-12 coding style.
- Prefer constructor property promotion: `public function __construct(private string $name) {}`.
- Use `match()` over `switch` for value matching.
- Always use prepared statements for database queries - never concatenate SQL.
- Use `filter_var()` for input validation.
- Error handling: exceptions over error codes. Never suppress with `@`.
