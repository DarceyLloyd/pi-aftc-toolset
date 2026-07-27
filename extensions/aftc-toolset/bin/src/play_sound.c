/*
 * play_sound.c -- tiny cross-platform audio player for pi-aftc-toolset.
 *
 * Plays an audio file (MP3, WAV, FLAC) and exits when playback finishes.
 * No window, no GUI, no interaction. Designed to be spawned detached
 * by the notify module and forgotten.
 *
 * Built on miniaudio (MIT-0 / Unlicense -- no attribution required).
 * https://github.com/mackron/miniaudio
 *
 * Build (per platform):
 *   Windows (MinGW-w64):
 *     gcc -O2 -s -o play_sound-win-x64.exe play_sound.c -lole32 -luuid
 *   Linux:
 *     gcc -O2 -s -o play_sound-linux-x64 play_sound.c -lpthread -lm -ldl
 *   macOS (x86_64):
 *     cc -O2 -s -o play_sound-macos-x64 play_sound.c -lpthread \
 *        -framework CoreAudio -framework AudioUnit -framework AudioToolbox
 *   macOS (arm64):
 *     cc -O2 -s -o play_sound-macos-arm64 play_sound.c -lpthread \
 *        -framework CoreAudio -framework AudioUnit -framework AudioToolbox
 */

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

#include <stdio.h>
#include <string.h>

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <audio-file>\n", argv[0]);
        return 1;
    }

    const char *filePath = argv[1];

    /* Initialise the audio engine (default device, default backend). */
    ma_engine engine;
    ma_result result = ma_engine_init(NULL, &engine);
    if (result != MA_SUCCESS) {
        fprintf(stderr, "play_sound: engine init failed (%d)\n", (int)result);
        return 1;
    }

    /* Load the sound from file. */
    ma_sound sound;
    result = ma_sound_init_from_file(&engine, filePath, 0, NULL, NULL, &sound);
    if (result != MA_SUCCESS) {
        fprintf(stderr, "play_sound: failed to load '%s' (%d)\n", filePath, (int)result);
        ma_engine_uninit(&engine);
        return 1;
    }

    /* Start playback. */
    result = ma_sound_start(&sound);
    if (result != MA_SUCCESS) {
        fprintf(stderr, "play_sound: playback start failed (%d)\n", (int)result);
        ma_sound_uninit(&sound);
        ma_engine_uninit(&engine);
        return 1;
    }

    /* Poll until playback finishes. */
    while (ma_sound_is_playing(&sound)) {
        ma_sleep(10); /* 10 ms */
    }

    /* Cleanup. */
    ma_sound_uninit(&sound);
    ma_engine_uninit(&engine);
    return 0;
}
