# Jawaban pertanyaan take-home

Ini jawaban untuk empat pertanyaan di bagian _Deliverables_ pada brief ("Jawab di README atau file terpisah"). Versi bahasa Inggris yang lebih ringkas ada di [README.md](README.md#questions-from-the-brief). Semua yang saya tulis di sini bisa dicek langsung di kode, dan bisa dijalankan ulang dengan `npm test` dan `npm run test:e2e`.

---

## 1. Bagaimana kamu memastikan audit log tidak ter-modifikasi?

Saya tidak mengandalkan satu mekanisme saja. Saya membuat beberapa lapisan pengaman, supaya kalau satu lapisan jebol (misalnya karena bug di kode yang ditulis nanti), lapisan lain masih menahan.

1. **Memang tidak ada jalur kode untuk mengubahnya.** API untuk audit log hanya `GET /api/tasks/:id/audit-logs`. Kalau ada yang mencoba `PUT`, `PATCH`, `POST`, atau `DELETE` ke URL audit log, hasilnya `404`, karena route-nya memang tidak ada. Di dalam aplikasi, interface penyimpanan (`TaskStore`) juga tidak punya method untuk mengubah atau menghapus entri audit. Yang bisa dilakukan hanya menambah dan membaca. Semua entri dibuat lewat satu fungsi saja, yaitu `buildLog` di `domain/audit-log.ts`.
2. **Trigger di database.** `audit_logs_no_update` dan `audit_logs_no_delete` menggagalkan setiap `UPDATE` atau `DELETE` pada tabel `audit_logs` dengan pesan `audit_logs is append-only`. Ini berlaku juga untuk SQL mentah, jadi tetap aman walaupun suatu hari ada query baru yang salah.
3. **Task tidak pernah benar-benar dihapus.** "Delete task" saya buat sebagai _soft delete_ (kolom `deleted_at`). Trigger `tasks_no_delete` dan foreign key `ON DELETE RESTRICT` mencegah baris task hilang, jadi log tidak bisa menjadi yatim atau ikut terhapus. Riwayat task yang sudah dihapus tetap bisa dibaca. Begitulah saya mendamaikan dua tuntutan di brief yang sekilas bertabrakan: "delete task" dan "audit log tidak boleh dihapus dalam keadaan apapun".
4. **Perubahan data dan log ditulis dalam satu transaksi** (`BEGIN IMMEDIATE`). Jadi status task dan entri auditnya selalu sinkron: tidak mungkin ada status yang berubah tanpa log, atau log tanpa perubahan. Pembacaan "status saat ini" juga dilakukan di dalam transaksi yang sama, sehingga dua request bersamaan tidak bisa sama-sama lolos pengecekan.
5. **Constraint pada bentuk baris** (`CHECK`). Contohnya, entri `status_changed` harus punya status asal dan tujuan yang berbeda, entri `created` harus berakhir di `to_do`, dan entri `edited` wajib menyebut field serta nilai lama dan nilai barunya. Baris yang tidak masuk akal ditolak oleh database.
6. **Mengubah data tidak mengubah arti log yang lama.** Setiap entri menyimpan judul task saat kejadian itu terjadi, dan untuk perubahan field juga menyimpan nilai lama dan nilai barunya. Jadi kalau judul task diganti, apa yang dikatakan riwayat sebelumnya tidak ikut berubah.
7. **Pulih sendiri saat aplikasi dijalankan.** Semua trigger di-`DROP` lalu dibuat ulang dari `schema.sql` setiap kali aplikasi start. Kalau ada trigger yang diubah atau dihapus secara manual, trigger itu dikembalikan saat restart. File database juga dibuat dengan izin `0600` di dalam direktori `0700`.
8. **Migrasi skema tidak mengubah riwayat.** Saat tabel `audit_logs` dibangun ulang pada migrasi v1 ke v2, semua baris disalin apa adanya beserta id-nya (diuji di `migration.test.ts`).

**Buktinya:** `apps/api/src/infrastructure/schema.test.ts` (SQL mentah ditolak), `apps/api/src/integration/assessment.conformance.test.ts` (setiap klausa brief, termasuk "tidak boleh diubah atau dihapus", lewat API dan lewat SQL mentah), dan `consistency.property.test.ts` (1.600 operasi acak: pindah status, edit, assign, hapus). Saya juga sengaja merusak aturan-aturan itu (melemahkan trigger, menghapus cabang idempotensi, melewati pengecekan urutan status) dan memastikan test-nya memang gagal.

**Risiko yang masih tersisa, saya sebut terus terang:** orang yang memegang file database saat aplikasi berjalan masih bisa menghapus trigger lalu mengubah data. Kalau ini penting, langkah berikutnya adalah _hash chaining_ antar baris (`prev_hash`), role database yang tidak punya hak `UPDATE` dan `DELETE` pada `audit_logs`, atau mengirim log ke penyimpanan _write-once_.

---

## 2. Bagian mana dari solusi ini yang paling berisiko jika digunakan oleh banyak user?

Urutannya dari yang paling berisiko:

1. **Identitas actor.** Sesuai brief, actor dipilih dari daftar tetap lewat dropdown dan dikirim sebagai header `X-Actor`. Artinya riwayat mencatat _klaim_ tentang siapa yang melakukan perubahan, bukan identitas yang terverifikasi. Kalau penggunanya banyak, nilai audit log turun, karena siapa pun bisa mengaku sebagai siapa pun, dan siapa pun bisa mengubah atau menghapus task orang lain (tidak ada role).
2. **SQLite dengan satu penulis dan driver yang sinkron.** Penulisan dilakukan satu per satu, dan driver `better-sqlite3` memblokir event loop Node selama query berjalan. Itu cukup untuk tim kecil, tetapi menjadi bottleneck kalau banyak penulisan terjadi bersamaan atau kalau server dijalankan dalam beberapa instance.
3. **Dua orang mengedit kartu yang sama pada saat yang sama.** Berlaku aturan _last write wins_. Riwayatnya tetap akurat (setiap penulisan mencatat nilai yang benar-benar ia gantikan), tetapi salah satu perubahan bisa tertimpa tanpa peringatan.
4. **Tidak ada pagination, batas jumlah, maupun rate limit.** `GET /tasks` dan daftar riwayat tidak dibatasi, dan satu user bisa membuat task sebanyak-banyaknya sampai disk penuh.
5. **Tabel `audit_logs` terus membesar.** Satu baris dibuat untuk setiap field yang berubah, dan baris itu tidak pernah dihapus (memang disengaja), jadi nanti perlu strategi pengarsipan.

Beberapa perlindungan sudah ada walaupun tanpa auth: server hanya mendengarkan di `127.0.0.1` dan hanya menerima daftar `Host` tertentu (melawan DNS rebinding), tidak ada CORS, validasi input ketat, SQL berparameter, serta batas ukuran body dan batas waktu request. Analisis ancaman lengkapnya ada di [docs/06-security-review.md](docs/06-security-review.md).

---

## 3. Jika task ini berkembang menjadi sistem besar, bagian mana yang akan kamu refactor terlebih dahulu dan kenapa?

**Dua hal pertama: identitas dan lapisan penyimpanan.**

1. **Identitas.** Saya akan menambahkan autentikasi dan mengambil `actor` dari sesi pengguna, bukan dari header yang dikirim klien. Ini yang pertama karena seluruh nilai produk ini (riwayat yang bisa dipercaya) bergantung pada kebenaran "siapa yang melakukan". Role dan izin menyusul setelahnya.
2. **Penyimpanan.** Saya akan mengganti `SqliteTaskStore` dengan implementasi PostgreSQL yang asinkron. Dari sisi arsitektur ini relatif murah, karena aplikasi hanya bergantung pada interface `TaskStore` (domain dan application tidak mengimpor SQLite), dan perilakunya sudah diuji oleh satu suite yang sama untuk implementasi fake maupun SQLite. Satu catatan jujur: interface-nya sekarang sinkron karena `better-sqlite3` sinkron, jadi pindah ke Postgres berarti mengubahnya menjadi `Promise`. Perubahannya mekanis, tetapi menyentuh service dan route. Keuntungan tambahannya: saya bisa memakai `REVOKE UPDATE, DELETE ON audit_logs` untuk role aplikasi, yang lebih kuat daripada trigger.

Sesudah itu: pagination untuk task dan riwayat, _optimistic locking_ untuk edit, dan memisahkan audit log menjadi modul tersendiri dengan pola _outbox_ kalau nanti ada konsumen lain (notifikasi, analitik). Urutan ini saya pilih karena dua yang pertama melindungi janji inti produk (riwayat yang benar dan tidak bisa dipalsukan), sedangkan sisanya soal skala dan kenyamanan.

---

## 4. Jika kamu menggunakan AI, jelaskan bagian mana yang dibantu AI dan bagaimana kamu memvalidasinya.

**Alat yang dipakai:** Claude Code.

**Bagian yang dibantu AI:**
- analisis brief, PRD, spesifikasi teknis, skema database, kontrak API, review keamanan, dan rancangan UI (semuanya ada di `docs/`);
- scaffold monorepo (API, web, dan package bersama);
- penulisan test (unit, integrasi, property test, E2E) dan dokumentasi.

**Keputusan produk ada pada saya**, misalnya papan bergaya Trello, daftar actor, soft delete, dan aliran status yang hanya maju. AI mengusulkan dan mengerjakan, saya yang meninjau dan memutuskan.

**Cara saya memvalidasinya (tidak percaya begitu saja):**
1. **Membandingkan kode dengan rencana.** Dokumen di `docs/` (PRD, tech spec, kontrak API, dan skema database) ditulis dan ditinjau berulang kali sebelum implementasi, termasuk satu putaran khusus keamanan. Setelah kodenya jadi, saya membandingkannya kembali dengan dokumen-dokumen itu dan memperbaiki yang tidak sesuai. Dari sini ketemu user story dan daftar file di dokumen yang masih menggambarkan versi pertama, sebuah paket `cn` yang terpasang tanpa sengaja oleh CLI shadcn, satu komponen yang sudah tidak dipakai, dan skrip coverage yang dijanjikan tetapi belum ada. Semua penyimpangan yang ditemukan selama membangun dicatat di [docs/08-implementation-plan.md](docs/08-implementation-plan.md).
2. **Menjalankan, bukan hanya membaca.** SQL skema dijalankan di SQLite sungguhan dan setiap aturan saya pancing. Dari sini ketemu bug nyata: `CHECK` lolos kalau nilainya `NULL`, sehingga baris `created` tanpa `to_status` seharusnya bisa masuk.
3. **Memastikan test bisa gagal.** Saya sengaja merusak aturan inti lalu memastikan test-nya merah: cabang idempotensi, pengecekan urutan status, trigger append-only, validasi assignee, dan constraint baris `edited`.
4. **Menguji proses yang sungguhan.** Smoke test pada server asli menemukan bug yang lolos dari unit test (log permintaan mencatat path `/`). Playwright menjalankan browser sungguhan: drag and drop dengan mouse, edit di popup, tab yang sudah usang, dan pemeriksaan aksesibilitas (axe) pada tema terang dan gelap di lebar 360, 768, dan 1280 px. Dari sini ketemu fokus keyboard yang hilang saat menyimpan dan kolom tujuan drop yang salah dipilih.
5. **Audit akhir terhadap brief.** Setiap klausa brief saya ubah menjadi test di `assessment.conformance.test.ts` (17 test). Audit ini menemukan satu hal yang bertentangan dengan brief: fitur memindahkan status mundur, yang melanggar "hanya mengikuti urutan". Fitur itu saya hapus, dan test akan gagal kalau ia muncul lagi.
6. **Dependensi dan kode yang dihasilkan.** Versi paket dicek ke npm. Konflik versi (TypeScript 7 dengan typescript-eslint) dan temuan `npm audit` (`concurrently` yang membawa `shell-quote`) saya selesaikan, tidak saya abaikan. Kode shadcn yang dihasilkan CLI saya tinjau dan perbaiki (import yang salah, dependensi yang tidak perlu, warna yang tidak mengikuti tema).
7. **Gerbang kualitas yang saya jalankan dari instalasi bersih:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` (412 test), `npm run test:e2e` (26 test), `npm run build`, dan `npm audit` (0 kerentanan).

**Catatan jujur soal cakupan:** brief menekankan solusi yang sederhana dan jelas, dan tidak menilai banyaknya fitur. Inti yang diminta brief sebenarnya kecil: API, package bersama, audit log, dan tampilan riwayat. Papan bergaya Trello, drag and drop, edit langsung di kartu, dan assign saya tambahkan atas permintaan product owner di atas inti yang sama, dan semuanya ikut diaudit, tetapi itu tambahan di luar brief. Pemetaan klausa brief ke kode dan test ada di bagian "How this maps to the brief" pada README.
