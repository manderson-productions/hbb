#pragma strict

class AiStats
{
	var numQuants = 16;

	var dexterity = 0.5;
	var rhythm = 0.5;
	var chords = 0.5;
	var sustain = 0.5;

	var noteValuePdf:float[];

	private var noteValuePdfSampler : PdfSampler = new PdfSampler();

	function RandomMusicalLength( secsPerMeasure:float ) : float
	{
		// top out at 16th notes for now, 2^(5-1) = 4
		var noteValue:int = noteValuePdfSampler.Sample();
		var s = secsPerMeasure / Mathf.Pow( 2, noteValue );
		return s;
	}

	function Awake()
	{
		noteValuePdfSampler.Reset( noteValuePdf );
	}

	function Randomize()
	{
		dexterity = Random.value;
		rhythm = Random.value;
		chords = Random.value;
		sustain = Random.value;

		//----------------------------------------
		//  Randomize note value PDF
		//----------------------------------------
		for( var i = 0; i < noteValuePdf.length; i++ )
			noteValuePdf[i] = 0.0;

		// 
		noteValuePdfSampler.Reset( noteValuePdf );
	}
}

var stats = new AiStats();

class RepeatStats
{
	var chordSize : float[];
	var spacings : float[];

	function Randomize()
	{
		var i:int;
		for( i = 0; i < chordSize.length; i++ )
			chordSize[i] = Random.value;
		for( i = 0; i < spacings.length; i++ )
			spacings[i] = Random.value;
	}
}

var repStats = new RepeatStats();

function Randomize()
{
	stats.Randomize();
}

//----------------------------------------
//  Unlike Note, which is the game object with gameplay state,
//	this just specifies the time, key, and duration
//----------------------------------------
class NoteSpec
{
	var measureTime : float;
	var key : int;
	var duration : float;
}

class Chord
{
	var measureTime : float;
	var key2down : boolean[];
	var key2mt : float[];
	var duration : float;

	function Chord( numKeys:int )
	{
		measureTime = 0.0;
		duration = 0.0;

		key2down = new boolean[numKeys];
		for( var i = 0; i < numKeys; i++ )
			key2down[i] = false;

		key2mt = new float[numKeys];
	}

	//----------------------------------------
	//  Size is just number of keys down in the chord
	//----------------------------------------
	function GetSize() : int
	{
		var n = 0;
		for( var i = 0; i < key2down.length; i++ )
		{
			if( key2down[i] )
				n++;
		}
		return n;
	}

	function IsSameKeys( other:Chord ) : boolean
	{
		for( var i = 0; i < key2down.length; i++ )
		{
			if( other.key2down[i] != key2down[i] )
				return false;
		}
		return true;
	}

	function AddNote( note:Note ) : void 
	{
		key2down[ note.key ] = true;
		// for now, don't allow multi-sustain chords
		duration = Mathf.Max( duration, note.GetDuration() );
		key2mt[ note.key ] = note.measureTime;
	}
}

function Awake()
{
	stats.Awake();
}

function RandomKeyExcluding( numKeys:int, exclude:int ) : int
{
	var k = Random.Range( 0, numKeys-1 );
	if( k >= exclude )
		k++;

	return k;
}

function CreateBeat(gs:GameState) : Array
{
	Debug.Log('create beat called');

	var beat = new Array();
	var numKeys = gs.GetSongInfo().GetNumSamples();

	var mt = 0.0;

	while( mt <= gs.GetSecsPerMeasure() )
	{
		var note = new NoteSpec();
		beat.Push( note );

		note.measureTime = mt;

		if( beat.length == 1 )
			note.key = Random.Range( 0, numKeys );
		else if( Random.value <= stats.dexterity )
		{
			// switch key
			var prevNote : NoteSpec = beat[ beat.length-2 ];
			note.key = RandomKeyExcluding( numKeys, prevNote.key );
		}
		else
		{
			// use previous note's key
			prevNote = beat[ beat.length-2 ];
			note.key = prevNote.key;
		}

		// make it last a little bit, to simulate what the player's inputs are like
		note.duration = gs.timeTolSecs/2;

		// chord?
		if( Random.value <= stats.chords )
		{
			var other = new NoteSpec();
			beat.Push( other );
			other.measureTime = mt;
			other.key = RandomKeyExcluding( numKeys, note.key );
			other.duration = note.duration;
		}

		mt += stats.RandomMusicalLength( gs.GetSecsPerMeasure() );
	}


	return beat;
}

function Time2Quant( mt:float, secsPerMeas:float ) : int
{
	return Mathf.RoundToInt( (mt/secsPerMeas) * stats.numQuants );
}

function AddChordToNoteSpecs( chord:Chord, notespecs:Array ) 
{
	for( var key = 0; key < chord.key2down.length; key++ )
	{
		if( chord.key2down[key] )
		{
			var spec = new NoteSpec();
			spec.measureTime = chord.key2mt[key];
			spec.key = key;
			spec.duration = chord.duration;
			notespecs.Push( spec );
		}
	}
}

function Beat2Chords( gs:GameState, beat:Array ) : Array
{
	var numKeys = gs.GetSongInfo().GetNumSamples();
	var chords = new Array();

	var prevNote : Note = null;

	for( var i = 0; i < beat.length; i++ )
	{
		var note = (beat[i] as Note);

		if( prevNote != null )
		{
			var p = Time2Quant( prevNote.measureTime, gs.GetSecsPerMeasure() );
			var q = Time2Quant( note.measureTime, gs.GetSecsPerMeasure() );
			var space = q-p;

			if( space == 0 )
			{
				// use previous chord
				var chord = (chords[ chords.length-1 ] as Chord);
				chord.AddNote( note );
			}
			else
			{
				// new chord
				chord = new Chord(numKeys);
				chord.measureTime = note.measureTime;
				chord.AddNote( note );
				chords.Push( chord );
			}
		}
		else
		{
			chord = new Chord(numKeys);
			chord.measureTime = note.measureTime;
			chord.AddNote( note );
			chords.Push( chord );
		}

		prevNote = note;
	}

	Debug.Log('num chords = ' + chords.length);

	return chords;
}

//----------------------------------------
//  Creates a beat that is the AI's attempt at repeating the given beat
//	Simulates messing up basically.
//----------------------------------------
function RepeatBeat( gs:GameState  ) : Array
{
	var numKeys = gs.GetSongInfo().GetNumSamples();

	Debug.Log('--');

	var notespecs = new Array();
	var chords = Beat2Chords( gs, gs.GetBeatNotes() );
	var prevChord : Chord = null;

	var debugSpacings = "";

	for( var i = 0; i < chords.length; i++ )
	{
		var chord = (chords[i] as Chord);

		// first, see if we fail cuz it's a chord
		if( Random.value > repStats.chordSize[ chord.GetSize() ]  )
		{
			Debug.Log('chord too complex');
		}
		else if( prevChord != null )
		{
			var p = Time2Quant( prevChord.measureTime, gs.GetSecsPerMeasure() );
			var q = Time2Quant( chord.measureTime, gs.GetSecsPerMeasure() );
			var space = q-p;

			debugSpacings = debugSpacings + ', '+space;

			if( space >= repStats.spacings.length
					|| Random.value < repStats.spacings[space] )
			{
				// Slow enough for us to get
				AddChordToNoteSpecs( chord, notespecs );
			}
			else
			{
				Debug.Log('TOO FAST!');
				// too fast for us!
				// pretend we messed up 
				// or we just didn't hit anything
			}
		}
		else
		{
			// always get the first note
			AddChordToNoteSpecs( chord, notespecs );
		}

		prevChord = chord;
	}

	Debug.Log('spacings = '+debugSpacings);

	return notespecs;
}
