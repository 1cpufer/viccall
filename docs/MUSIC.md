# Artist playlist

Players can choose **Artist playlist** under Sound settings. It plays real songs, shuffled, through the same music volume and mute. At the start of each song it shows "Now playing: Song by Artist", with a link to the artist's page. During a round it turns down to half volume.

The list starts empty. Until a song is added, the option stays hidden, and anyone who had chosen it hears Monaco instead.

## Before a song goes in: permission

Every song has two sets of rights:

- **The recording:** usually the artist, or their label if they're signed.
- **The song itself (lyrics and melody):** the songwriter, or their publisher.

Independent artists who release their own music usually own both, so one written "yes" covers it. Signed artists mean asking the label and the publisher.

Get the permission in writing, covering:

1. which songs, by name
2. that they may be streamed in VicCall, the web game and any app versions, worldwide
3. whether it's free or paid
4. how the artist is credited, and the link to use
5. that the person giving permission owns or controls both the recording and the song
6. how either side can end it (for example, 30 days' notice), and that the song is then removed

Keep the written permission somewhere permanent, such as a PDF in a folder or the email thread. This isn't legal advice, and for a paid or signed-artist deal, have a lawyer look at it.

## Adding a song

1. **Prepare the file.** Use MP3 at 192 kbps or better. Keep the volume even with the other songs (around −14 LUFS) and the file under 15 MB. Name it `artist-song.mp3`, lowercase with dashes.
2. **Add the file** to `public/music/`.
3. **List it** in `public/music/tracks.json`:

```json
{
  "tracks": [
    {
      "id": "artist-song",
      "title": "Song",
      "artist": "Artist",
      "link": "https://the-artists-page.example",
      "file": "music/artist-song.mp3",
      "licence": {
        "kind": "written permission",
        "from": "Artist name, who owns the recording and the song",
        "granted": "2026-11-02",
        "scope": "VicCall web game and apps, worldwide, free, until ended with 30 days' notice",
        "evidence": "Signed form: Google Drive / VicCall / music / artist.pdf"
      }
    }
  ]
}
```

4. **Run `npm test`.** It refuses a song without a complete permission record (`from`, `granted`, `scope`, `evidence`), and a missing or oversized file.
5. **Deploy.** Songs are cached for a week, so a changed song needs a new file name.

To take a song out, delete its entry and its file. Setting `"enabled": false` hides it but keeps the record.

## How it works

`public/audio.js` reads `music/tracks.json` and plays each file through an audio element connected to the music bus. Shuffling never starts a new round of songs with the one that just played, and a song that fails to load is skipped. Playback pauses while the tab is hidden.

`e2e/music.e2e.js` checks all of this in a real browser, using two short generated test tones as stand-ins for songs.
