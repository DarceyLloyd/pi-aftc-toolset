# vsftpd

## Rules

## Gotchyas

- [vF7dK2] force_dot_files default NO - dotfiles/dot-dirs (.htaccess, .gitkeep, .old/, .well-known) are HIDDEN from FTP listings, so clients see folders containing only dotfiles as EMPTY and recursive deletes fail (bare RMD -> 550), and dotfiles can't be managed at all; set force_dot_files=YES in /etc/vsftpd.conf and restart vsftpd.
- [rM3nQ8] RMD only removes EMPTY directories - the FTP protocol has no recursive delete, the CLIENT must DELE every file and RMD subdirs bottom-up itself (FileZilla does this automatically); a bare RMD on a non-empty dir always returns 550, so anything hidden from the client (see force_dot_files) breaks folder deletes.

## Issues & Solutions
