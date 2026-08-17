# Web-scraping

## Rules

- [2qkLdz] Before scraping a web shop's HTML, check for the platform's public product JSON API: WooCommerce stores expose /wp-json/wc/store/v1/products (paged, with prices/images/categories/descriptions and X-WP-Total headers) and Shopify stores expose /products.json - both give clean structured data without HTML parsing (Shopify's may 403 behind bot protection).

## Gotchyas

- [jm5liW] Product-page HTML galleries mix the product's own images with cross-sell/related-product thumbnails - filter page image URLs by matching the product name's significant tokens (first 2-3 alpha words, lowercased) against the image filename, which isolates the product's real gallery reliably.

## Issues & Solutions
