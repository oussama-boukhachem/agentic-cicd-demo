#!/usr/bin/env node
/** Build a narrated video from video/script.json: TTS per scene, render, concat, mux. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TMP = '/tmp/sh-build';
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(join(ROOT, 'video/out'), { recursive: true });

const scriptPath = process.env.SCRIPT || join(ROOT, 'video/script.json');
const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
const TTS = process.env.TTS_BIN || (process.env.HOME + '/.local/bin/openclaw-piper');
const PAD = 1.0;

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nw=1:nk=1', f]).toString().trim());

const videos = [];
const audios = [];

script.scenes.forEach((scene, i) => {
  const vo = join(TMP, 'vo-' + i + '.wav');
  let voDur = 0;
  if (scene.vo) {
    run(TTS, [scene.vo, vo]);
    voDur = dur(vo);
  }
  const seconds = Math.max(scene.min || 0, voDur + PAD, scene.kind === 'title' ? 4 : 3);
  const vid = join(TMP, 'scene-' + i + '.mp4');
  if (scene.kind === 'clip') {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-stream_loop', '-1', '-ss', String(scene.start || 0),
      '-i', scene.clip, '-t', String(seconds),
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b0d10,fps=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', vid]);
  } else {
    const png = join(TMP, 'scene-' + i + '.png');
    const args = scene.kind === 'title'
      ? ['video/shot.mjs', 'title', png, scene.main, scene.sub || '']
      : scene.kind === 'diagram'
      ? ['video/shot.mjs', 'diagram', png, '', '']
      : ['video/shot.mjs', 'term', png, scene.log, ''];
    run('node', args);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-t', String(seconds),
      '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', vid]);
  }
  videos.push(vid);

  const padded = join(TMP, 'audio-' + i + '.wav');
  if (scene.vo) {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', vo, '-af',
      'adelay=300|300,apad=whole_dur=' + seconds + ',aresample=48000', '-ac', '2', padded]);
  } else {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-t', String(seconds), padded]);
  }
  audios.push(padded);
  console.log('scene ' + (i + 1) + '/' + script.scenes.length + '  ' + seconds.toFixed(1) + 's  ' + (scene.main || scene.log));
});

const listFile = join(TMP, 'videos.txt');
writeFileSync(listFile, videos.map((v) => "file '" + v + "'").join('\n'));
const joined = join(TMP, 'video.mp4');
run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined]);

const aList = join(TMP, 'audios.txt');
writeFileSync(aList, audios.map((v) => "file '" + v + "'").join('\n'));
const narration = join(TMP, 'narration.wav');
run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', aList, '-c', 'copy', narration]);

const outPath = join(ROOT, script.output || 'video/out/final.mp4');
run('ffmpeg', ['-y', '-loglevel', 'error', '-i', joined, '-i', narration,
  '-vf', 'scale=1920:1080:flags=lanczos', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast',
  '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-shortest',
  '-movflags', '+faststart', outPath]);
console.log('wrote ' + outPath + '  (' + dur(outPath).toFixed(1) + 's)');