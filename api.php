<?php
/*
 * Tontechnikplan – Server-Schnittstelle
 * Eine Datei, keine Datenbank: der Plan liegt als JSON im Ordner data/.
 *
 *   GET  api.php?action=info                 Server-Infos (öffentlich)
 *   GET  api.php?action=load                 Plan laden (öffentlich)
 *   GET  api.php?action=rev                  nur Versionsnummer (zum Abfragen auf Änderungen)
 *   GET  api.php?action=ics&person=ID        persönlicher Kalender (öffentlich, zum Abonnieren)
 *   POST api.php?action=login                {password} → {token}
 *   POST api.php?action=save                 {baseRev, data} (angemeldet)
 */

declare(strict_types=1);

$config = require __DIR__ . '/config.php';
$dataDir = rtrim($config['data_dir'] ?? (__DIR__ . '/data'), '/');
date_default_timezone_set($config['timezone'] ?? 'Europe/Berlin');

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $code = 400): void {
    respond(['error' => $message], $code);
}

function body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 8 * 1024 * 1024) fail('Anfrage zu groß', 413);
    $data = json_decode($raw ?: '{}', true);
    if (!is_array($data)) fail('Ungültige Anfrage');
    return $data;
}

/* ---------- Datenordner ---------- */
function ensureDataDir(string $dir): void {
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) fail('Datenordner kann nicht angelegt werden: ' . $dir, 500);
    if (!is_writable($dir)) fail('Datenordner ist nicht beschreibbar: ' . $dir, 500);
    // Schutz für Apache; bei nginx siehe README
    if (!file_exists("$dir/.htaccess")) @file_put_contents("$dir/.htaccess", "Require all denied\nDeny from all\n");
    if (!file_exists("$dir/index.html")) @file_put_contents("$dir/index.html", '');
}

function writeAtomic(string $file, string $content): void {
    $tmp = $file . '.tmp' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $content, LOCK_EX) === false || !rename($tmp, $file)) {
        @unlink($tmp);
        fail('Speichern auf dem Server fehlgeschlagen', 500);
    }
}

function readJsonFile(string $file, $default) {
    if (!file_exists($file)) return $default;
    $data = json_decode((string) file_get_contents($file), true);
    return $data ?? $default;
}

/* ---------- Anmeldung (signierter Token, kein Session-Speicher nötig) ---------- */
function secret(string $dir): string {
    $file = "$dir/secret.key";
    if (!file_exists($file)) writeAtomic($file, bin2hex(random_bytes(32)));
    return trim((string) file_get_contents($file));
}

// Das Passwort fließt in den Schlüssel ein: Passwort ändern = alle Geräte abgemeldet
function signingKey(array $config, string $dir): string {
    return secret($dir) . '|' . (string) ($config['edit_password'] ?? '');
}

function makeToken(array $config, string $dir): string {
    $exp = (string) (time() + 86400 * (int) ($config['login_days'] ?? 180));
    return $exp . '.' . hash_hmac('sha256', $exp, signingKey($config, $dir));
}

function requireAuth(array $config, string $dir): void {
    $token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    $parts = explode('.', $token, 2);
    if (count($parts) === 2 && ctype_digit($parts[0]) && (int) $parts[0] > time()
        && hash_equals(hash_hmac('sha256', $parts[0], signingKey($config, $dir)), $parts[1])) {
        return;
    }
    fail('Nicht angemeldet', 401);
}

/* ---------- Kalender (iCalendar) ---------- */
function icsEscape(string $s): string {
    return str_replace(["\\", ';', ',', "\r\n", "\n"], ["\\\\", '\;', '\,', '\n', '\n'], $s);
}

function icsFold(string $line): string {
    $out = '';
    while (strlen($line) > 74) {
        $cut = 74;
        while ($cut > 0 && (ord($line[$cut]) & 0xC0) === 0x80) $cut--; // UTF-8-Zeichen nicht zerteilen
        $out .= substr($line, 0, $cut) . "\r\n ";
        $line = substr($line, $cut);
    }
    return $out . $line;
}

function outputIcs(array $config, string $dir, string $personId): void {
    $file = readJsonFile("$dir/plan.json", null);
    $plan = $file['data'] ?? null;
    if (!$plan) fail('Noch kein Plan gespeichert', 404);
    $people = [];
    foreach ($plan['people'] ?? [] as $p) $people[$p['id']] = $p['name'];
    if (!isset($people[$personId])) fail('Person nicht gefunden', 404);

    $s = $plan['settings'] ?? [];
    $col1 = $s['col1'] ?? 'Studio';
    $col2 = $s['col2'] ?? 'Mischpult';
    $duration = (int) ($config['calendar']['duration_minutes'] ?? 120);
    $reminder = (int) ($config['calendar']['reminder_minutes'] ?? 120);
    $from = date('Y-m-d', time() - 60 * 86400);
    $stamp = gmdate('Ymd\THis\Z');
    $host = preg_replace('/[^a-z0-9.-]/i', '', explode(':', $_SERVER['HTTP_HOST'] ?? 'tontechnikplan')[0]) ?: 'tontechnikplan';

    $lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tontechnikplan//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'X-WR-CALNAME:' . icsEscape(($s['title'] ?? 'Technikerdienst') . ' – ' . $people[$personId]),
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ];
    foreach ($plan['events'] ?? [] as $e) {
        $slot = array_search($personId, $e['people'] ?? [], true);
        if ($slot === false || ($e['date'] ?? '') < $from) continue;
        $start = DateTime::createFromFormat('Y-m-d H:i', $e['date'] . ' ' . ($e['time'] ?? '00:00'));
        if (!$start) continue;
        $end = (clone $start)->modify("+$duration minutes");
        $single = ($e['slots'] ?? 2) === 1;
        $role = $single ? 'allein' : ($slot === 0 ? $col1 : $col2);
        $partnerId = $single ? null : ($e['people'][1 - $slot] ?? null);
        $desc = 'Aufgabe: ' . $role . ($partnerId ? "\nmit " . ($people[$partnerId] ?? '??') : '') . (!empty($s['note']) ? "\n" . $s['note'] : '');
        $lines[] = 'BEGIN:VEVENT';
        $lines[] = 'UID:' . $e['id'] . '-' . $personId . '@' . $host;
        $lines[] = 'DTSTAMP:' . $stamp;
        $lines[] = 'DTSTART:' . $start->format('Ymd\THis');
        $lines[] = 'DTEND:' . $end->format('Ymd\THis');
        $lines[] = 'SUMMARY:' . icsEscape('Technik: ' . ($e['title'] ?? '') . ' (' . $role . ')');
        $lines[] = 'DESCRIPTION:' . icsEscape($desc);
        if ($reminder > 0) {
            array_push($lines, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' . icsEscape('Technikerdienst: ' . ($e['title'] ?? '')),
                "TRIGGER:-PT{$reminder}M", 'END:VALARM');
        }
        $lines[] = 'END:VEVENT';
    }
    $lines[] = 'END:VCALENDAR';

    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: inline; filename="technikerdienst.ics"');
    echo implode("\r\n", array_map('icsFold', $lines)) . "\r\n";
    exit;
}

/* ---------- Ablauf ---------- */
ensureDataDir($dataDir);
$planFile = "$dataDir/plan.json";
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

switch ($action) {
    case 'info':
        respond(['ok' => true, 'calendar' => true]);

    case 'load':
        header('Content-Type: application/json; charset=utf-8');
        // Datei unverändert ausliefern, damit leere Objekte/Listen exakt erhalten bleiben
        echo file_exists($planFile) ? file_get_contents($planFile) : '{"rev":0,"updatedAt":null,"data":null}';
        exit;

    case 'rev':
        $meta = readJsonFile("$dataDir/rev.json", ['rev' => 0, 'updatedAt' => null]);
        respond($meta);

    case 'ics':
        outputIcs($config, $dataDir, (string) ($_GET['person'] ?? ''));

    case 'login':
        if ($method !== 'POST') fail('POST erwartet', 405);
        $pw = (string) (body()['password'] ?? '');
        $expected = (string) ($config['edit_password'] ?? '');
        if ($expected === '' || $expected === 'bitte-aendern') fail('Bitte zuerst in config.php ein eigenes Passwort festlegen.', 403);
        if (!hash_equals($expected, $pw)) {
            sleep(1); // bremst das Durchprobieren von Passwörtern
            fail('Das Passwort ist falsch.', 401);
        }
        respond(['token' => makeToken($config, $dataDir)]);

    case 'save':
        if ($method !== 'POST') fail('POST erwartet', 405);
        requireAuth($config, $dataDir);
        $req = body();
        $raw = $req['data'] ?? null;
        if (!is_string($raw)) fail('Keine Daten');
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || !isset($decoded['people'], $decoded['events'])) fail('Ungültige Plandaten');

        $lock = fopen("$dataDir/.lock", 'c');
        flock($lock, LOCK_EX);
        try {
            $meta = readJsonFile("$dataDir/rev.json", ['rev' => 0, 'updatedAt' => null]);
            if ((int) ($req['baseRev'] ?? -1) !== (int) $meta['rev'] && file_exists($planFile)) {
                http_response_code(409);
                header('Content-Type: application/json; charset=utf-8');
                echo file_get_contents($planFile);
                exit;
            }
            // Tägliche Sicherung des vorherigen Stands (die letzten 60 Tage bleiben erhalten)
            if (file_exists($planFile)) {
                $backupDir = "$dataDir/backups";
                if (!is_dir($backupDir)) mkdir($backupDir, 0775, true);
                $backup = "$backupDir/plan-" . date('Y-m-d') . '.json';
                if (!file_exists($backup)) copy($planFile, $backup);
                $old = glob("$backupDir/plan-*.json") ?: [];
                sort($old);
                foreach (array_slice($old, 0, max(0, count($old) - 60)) as $f) @unlink($f);
            }
            $rev = (int) $meta['rev'] + 1;
            $now = date('c');
            writeAtomic($planFile, '{"rev":' . $rev . ',"updatedAt":' . json_encode($now) . ',"data":' . $raw . '}');
            writeAtomic("$dataDir/rev.json", json_encode(['rev' => $rev, 'updatedAt' => $now]));
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        respond(['rev' => $rev, 'updatedAt' => $now]);

    default:
        fail('Unbekannte Aktion', 404);
}
