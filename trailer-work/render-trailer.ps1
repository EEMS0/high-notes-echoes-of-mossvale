$ErrorActionPreference = 'Stop'

$ffmpeg = 'C:\Users\PC\AppData\Local\Temp\codex-highnotes-ffmpeg\extracted\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe'
$project = 'C:\Users\PC\Documents\RPG adventure game - Copy'
$work = Join-Path $project 'trailer-work'
$delivery = Join-Path $project 'trailer'
$fontDisplay = 'C\:/Windows/Fonts/georgiab.ttf'
$fontMono = 'C\:/Windows/Fonts/consolab.ttf'

New-Item -ItemType Directory -Path $delivery -Force | Out-Null

function Invoke-Ffmpeg {
  param([string[]]$Arguments)
  & $ffmpeg @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "FFmpeg failed with exit code $LASTEXITCODE"
  }
}

function TrailerText {
  param(
    [string]$Heading,
    [string]$Kicker,
    [double]$Duration
  )
  $fadeOut = [Math]::Max(0, $Duration - 0.18).ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
  return "drawbox=x=0:y=ih-134:w=iw:h=134:color=black@0.58:t=fill," +
    "drawtext=fontfile='$fontMono':text='$Kicker':fontcolor=0xffc857:fontsize=21:x=(w-text_w)/2:y=h-114:shadowcolor=black@0.9:shadowx=2:shadowy=2," +
    "drawtext=fontfile='$fontDisplay':text='$Heading':fontcolor=white:fontsize=45:x=(w-text_w)/2:y=h-82:shadowcolor=black@0.9:shadowx=3:shadowy=3," +
    "fade=t=in:st=0:d=0.18,fade=t=out:st=$fadeOut`:d=0.18,format=yuv420p"
}

$titleFilter = "scale=1400:788:flags=lanczos,zoompan=z='min(zoom+0.00028,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30," +
  "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.08:t=fill," +
  "drawtext=fontfile='$fontMono':text='THE GROVE REMEMBERS EVERY NOTE':fontcolor=0xffc857:fontsize=24:x=(w-text_w)/2:y=h-54:shadowcolor=black@0.95:shadowx=3:shadowy=3," +
  "fade=t=in:st=0:d=0.5,fade=t=out:st=3.02:d=0.18,format=yuv420p"
Invoke-Ffmpeg @(
  '-hide_banner','-loglevel','error','-y',
  '-f','image2','-loop','1','-framerate','30','-c:v','mjpeg','-i',(Join-Path $work 'title.png'),
  '-t','3.2','-vf',$titleFilter,
  '-r','30','-c:v','libx264','-preset','medium','-crf','16',(Join-Path $work 'seg01-title.mp4')
)

$filter = "trim=start=0.35:duration=5,setpts=PTS-STARTPTS," + (TrailerText 'FIND THE FORGOTTEN SONG' 'EXPLORE + FIGHT + LISTEN' 5)
Invoke-Ffmpeg @('-hide_banner','-loglevel','error','-y','-i',(Join-Path $work 'mossvale.mp4'),'-vf',$filter,'-r','30','-c:v','libx264','-preset','medium','-crf','17',(Join-Path $work 'seg02-mossvale.mp4'))

$filter = "trim=start=0.15:duration=2.4,setpts=PTS-STARTPTS," + (TrailerText 'FOUR WORLDS. ONE RESONANCE.' 'A HANDCRAFTED LIVING ATLAS' 2.4)
Invoke-Ffmpeg @('-hide_banner','-loglevel','error','-y','-i',(Join-Path $work 'map.mp4'),'-vf',$filter,'-r','30','-c:v','libx264','-preset','medium','-crf','17',(Join-Path $work 'seg03-map.mp4'))

$filter = "trim=start=0.25:duration=4,setpts=PTS-STARTPTS," + (TrailerText 'BREAK THE ROOTSONG' 'BASS + ELITES + MINI-BOSSES' 4)
Invoke-Ffmpeg @('-hide_banner','-loglevel','error','-y','-i',(Join-Path $work 'rootsong.mp4'),'-vf',$filter,'-r','30','-c:v','libx264','-preset','medium','-crf','17',(Join-Path $work 'seg04-rootsong.mp4'))

$filter = "trim=start=0.2:duration=4,setpts=PTS-STARTPTS," + (TrailerText 'BEND THE STORM' 'SYNTH + CRYSTAL WEATHER + DRAGONS' 4)
Invoke-Ffmpeg @('-hide_banner','-loglevel','error','-y','-i',(Join-Path $work 'skyglass.mp4'),'-vf',$filter,'-r','30','-c:v','libx264','-preset','medium','-crf','17',(Join-Path $work 'seg05-skyglass.mp4'))

$filter = "trim=start=0.3:duration=4.6,setpts=PTS-STARTPTS," + (TrailerText 'FACE THE MUSIC' 'VIOLIN + BLOOD MOON + TIDEBREAKER' 4.6)
Invoke-Ffmpeg @('-hide_banner','-loglevel','error','-y','-i',(Join-Path $work 'moonwake.mp4'),'-vf',$filter,'-r','30','-c:v','libx264','-preset','medium','-crf','17',(Join-Path $work 'seg06-moonwake.mp4'))

$uiSegments = @(
  @{ File='instruments.png'; Out='seg07-instruments.mp4'; Duration=2.3; Heading='MASTER SIX INSTRUMENTS'; Kicker='ATTACKS + SPECIALS + ULTIMATES' },
  @{ File='skills.png'; Out='seg08-skills.mp4'; Duration=2.3; Heading='BUILD YOUR RESONANCE'; Kicker='SEVEN BRANCHES + NO SINGLE BEST BUILD' },
  @{ File='home.png'; Out='seg09-home.mp4'; Duration=2.3; Heading='MAKE THE WORLD YOUR HOME'; Kicker='CRAFT + GROW + TRAIN ODIN + DECORATE' },
  @{ File='shop.png'; Out='seg10-shop.mp4'; Duration=1.9; Heading='POWER UP. GET WEIRD.'; Kicker='BRADS PREMIUM GOODS' }
)
foreach ($segment in $uiSegments) {
  $duration = [double]$segment.Duration
  $frames = [Math]::Round($duration * 30)
  $filter = "scale=1400:788:flags=lanczos,zoompan=z='min(zoom+0.00042,1.075)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30," +
    (TrailerText $segment.Heading $segment.Kicker $duration)
  Invoke-Ffmpeg @(
    '-hide_banner','-loglevel','error','-y',
    '-f','image2','-loop','1','-framerate','30','-c:v','mjpeg','-i',(Join-Path $work $segment.File),
    '-frames:v',"$frames",'-vf',$filter,
    '-r','30','-c:v','libx264','-preset','medium','-crf','16',(Join-Path $work $segment.Out)
  )
}

$filter = "trim=start=0.35:duration=3.2,setpts=PTS-STARTPTS," + (TrailerText 'A WORLD THAT LISTENS' 'EVENTS + WEATHER + SECRETS + QUESTS' 3.2)
Invoke-Ffmpeg @('-hide_banner','-loglevel','error','-y','-i',(Join-Path $work 'map.mp4'),'-vf',$filter,'-r','30','-c:v','libx264','-preset','medium','-crf','17',(Join-Path $work 'seg11-world.mp4'))

$montageFilter = "[0:v]trim=start=4.6:duration=0.8,setpts=PTS-STARTPTS[v0];" +
  "[1:v]trim=start=3.8:duration=0.8,setpts=PTS-STARTPTS[v1];" +
  "[2:v]trim=start=3.8:duration=0.8,setpts=PTS-STARTPTS[v2];" +
  "[3:v]trim=start=4.8:duration=0.8,setpts=PTS-STARTPTS[v3];" +
  "[v0][v1][v2][v3]concat=n=4:v=1:a=0,fade=t=in:st=0:d=0.08,fade=t=out:st=3.04:d=0.16,format=yuv420p[out]"
Invoke-Ffmpeg @(
  '-hide_banner','-loglevel','error','-y',
  '-i',(Join-Path $work 'mossvale.mp4'),'-i',(Join-Path $work 'rootsong.mp4'),
  '-i',(Join-Path $work 'skyglass.mp4'),'-i',(Join-Path $work 'moonwake.mp4'),
  '-filter_complex',$montageFilter,'-map','[out]',
  '-r','30','-c:v','libx264','-preset','medium','-crf','16',(Join-Path $work 'seg12-montage.mp4')
)

$endFilter = "scale=1400:788:flags=lanczos,zoompan=z='min(zoom+0.0003,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30," +
  "drawbox=x=0:y=0:w=610:h=720:color=black@0.62:t=fill," +
  "drawtext=fontfile='$fontDisplay':text='HIGH NOTES':fontcolor=white:fontsize=72:x=70:y=176:shadowcolor=black@0.95:shadowx=4:shadowy=4," +
  "drawtext=fontfile='$fontMono':text='ECHOES OF MOSSVALE':fontcolor=0xffc857:fontsize=29:x=75:y=275:shadowcolor=black@0.95:shadowx=3:shadowy=3," +
  "drawbox=x=74:y=330:w=430:h=2:color=0xffc857@0.9:t=fill," +
  "drawtext=fontfile='$fontDisplay':text='THE WORLD IS WAITING':fontcolor=white:fontsize=31:x=75:y=370:shadowcolor=black@0.95:shadowx=3:shadowy=3," +
  "drawtext=fontfile='$fontDisplay':text='TO HEAR YOU.':fontcolor=white:fontsize=31:x=75:y=412:shadowcolor=black@0.95:shadowx=3:shadowy=3," +
  "drawtext=fontfile='$fontMono':text='PLAY THE RHYTHM. CHANGE THE WORLD.':fontcolor=0x9de8ff:fontsize=18:x=77:y=493:shadowcolor=black@0.95:shadowx=2:shadowy=2," +
  "fade=t=in:st=0:d=0.35,fade=t=out:st=4.22:d=0.38,format=yuv420p"
Invoke-Ffmpeg @(
  '-hide_banner','-loglevel','error','-y',
  '-loop','1','-framerate','30','-i',(Join-Path $project 'assets\mossvale-key-art.png'),
  '-t','4.6','-vf',$endFilter,
  '-r','30','-c:v','libx264','-preset','medium','-crf','16',(Join-Path $work 'seg13-end.mp4')
)

$segments = @(
  'seg01-title.mp4','seg02-mossvale.mp4','seg03-map.mp4','seg04-rootsong.mp4','seg05-skyglass.mp4',
  'seg06-moonwake.mp4','seg07-instruments.mp4','seg08-skills.mp4','seg09-home.mp4','seg10-shop.mp4',
  'seg11-world.mp4','seg12-montage.mp4','seg13-end.mp4'
)
$concatArgs = @('-hide_banner','-loglevel','error','-y')
foreach ($segment in $segments) {
  $concatArgs += @('-i',(Join-Path $work $segment))
}
$concatPreparations = for ($index = 0; $index -lt $segments.Count; $index++) {
  "[$index`:v]setpts=PTS-STARTPTS,setsar=1[v$index]"
}
$concatInputs = for ($index = 0; $index -lt $segments.Count; $index++) { "[v$index]" }
$concatFilter = ($concatPreparations -join ';') + ';' + ($concatInputs -join '') +
  "concat=n=$($segments.Count):v=1:a=0,format=yuv420p[outv]"
$concatArgs += @(
  '-filter_complex',$concatFilter,'-map','[outv]',
  '-r','30','-c:v','libx264','-preset','slow','-crf','16','-movflags','+faststart',
  (Join-Path $work 'trailer-silent.mp4')
)
Invoke-Ffmpeg $concatArgs

$finalPath = Join-Path $delivery 'HIGH_NOTES_Echoes_of_Mossvale_Official_Trailer.mp4'
Invoke-Ffmpeg @(
  '-hide_banner','-loglevel','error','-y',
  '-i',(Join-Path $work 'trailer-silent.mp4'),'-i',(Join-Path $work 'trailer-score.wav'),
  '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-ar','48000',
  '-af','loudnorm=I=-14:LRA=9:TP=-1.5','-shortest','-movflags','+faststart',
  '-metadata','title=HIGH NOTES: Echoes of Mossvale - Official Trailer',
  '-metadata','artist=HIGH NOTES',
  $finalPath
)

$posterPath = Join-Path $delivery 'HIGH_NOTES_Trailer_Poster.jpg'
Invoke-Ffmpeg @(
  '-hide_banner','-loglevel','error','-y',
  '-ss','40.4','-i',$finalPath,'-frames:v','1','-q:v','2',$posterPath
)

Get-Item -LiteralPath $finalPath,$posterPath | Select-Object Name,Length,LastWriteTime
