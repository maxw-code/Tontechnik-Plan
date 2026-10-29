<?php
// Einstellungen für den Server. Diese Datei wird vom Webserver ausgeführt, nicht ausgeliefert –
// das Passwort ist also nicht öffentlich sichtbar.
return [
    // Passwort für den Bearbeitungsmodus (bekommen alle Techniker).
    // Wird es geändert, müssen sich alle Geräte neu anmelden.
    'edit_password' => 'bitte-aendern',

    // Wie lange ein Gerät angemeldet bleibt (Tage)
    'login_days' => 180,

    // Hier liegen der Plan und die täglichen Sicherungen. Muss für PHP beschreibbar sein.
    'data_dir' => __DIR__ . '/data',

    'timezone' => 'Europe/Berlin',

    // Persönliche Kalender-Abos (Handy-Kalender)
    'calendar' => [
        'duration_minutes' => 120,   // angenommene Dauer eines Dienstes
        'reminder_minutes' => 120,   // Erinnerung vorher (0 = keine)
    ],
];
