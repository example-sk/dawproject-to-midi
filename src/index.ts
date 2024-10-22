import { MidiControllerEvent, MidiEvent, MidiNoteOffEvent, MidiNoteOnEvent, MidiSetTempoEvent, MidiTrackNameEvent, writeMidi, parseMidi, MidiEndOfTrackEvent, MidiTimeSignatureEvent } from 'midi-file'
import JSZip from 'jszip';
import { TCc, TTrack } from './types/track.ts';

class DawprojectToMidi {
    tempo: number = 120 // standard default value
    numerator: number = 4 // standard default value
    denominator: number = 4 // standard default value
    tracks: Array<TTrack>
    trackById: { [key: string]: TTrack }
    doc: XMLDocument
    constructor(file) {
        this.setStatus("reading zip file...");
        this.tracks = [];
        this.trackById = {};
        const zip = new JSZip();
        zip.loadAsync(file)
            .then((zip: JSZip) => zip.file('project.xml')!.async('string'))
            .then((res: string) => {
                this.setStatus('parsing project...');
                this.parseXml(res);
                this.readTempo();
                this.findTracks();
                this.findChildrenTracks();
                this.findNotes();
                this.sortNotes();
                this.generateMidiFile();
                this.setStatus('Done. Please check your Downloads for a new MIDI file.');
            })
    }
    setStatus(text: string) {
        document.getElementById('status')!.textContent = text;
    }
    _xpath(expr: string, contextEl?: Node | null | undefined): Array<Node> {
        const ret: Array<Node> = [];
        const xpath = this.doc.evaluate(expr, contextEl ?? this.doc.documentElement);
        let el: Node | null;
        while (el = xpath.iterateNext()) {
            ret.push(el);
        }
        return ret;
    }
    readTempo() {
        this._xpath('/Project/Transport/Tempo[@unit="bpm"]').forEach(tempoEl => {
            this.tempo = parseFloat(tempoEl.getAttribute('value'));
            this._xpath('/Project/Transport/TimeSignature').forEach(signatureEl => {
                this.numerator = parseFloat(signatureEl.getAttribute('numerator'));
                this.denominator = parseFloat(signatureEl.getAttribute('denominator'));
            });
        });
    }
    generateMidiFile() {
        const writeTracks: Array<MidiEvent[]> = [];
        this.tracks.forEach(track => {
            if (track.notes.length === 0) {
                return;
            }
            const nameEvent: MidiTrackNameEvent = {
                deltaTime: 0,
                text: track.name,
                type: 'trackName',
                _startTime: 0,
            };
            const miditrack: Array<MidiEvent> = [
                nameEvent
            ];
            track.ccList.forEach(cc => {
                const msg: MidiControllerEvent = {
                    channel: cc.channel,
                    controllerType: cc.controller,
                    deltaTime: 0, // later will be changed
                    type: 'controller',
                    value: cc.value,
                    _startTime: cc.startTime,
                };
                miditrack.push(msg)
            });
            track.notes.forEach(note => {
                miditrack.push(<MidiNoteOnEvent>{
                    channel: note.channel,
                    deltaTime: 0, // later will be changed
                    noteNumber: note.key,
                    type: 'noteOn',
                    velocity: note.velocity * 127,
                    _startTime: note.startTime,
                });
                miditrack.push(<MidiNoteOffEvent>{
                    channel: note.channel,
                    deltaTime: 0, // later will be changed
                    noteNumber: note.key,
                    type: 'noteOff',
                    velocity: note.velocity * 127,
                    _startTime: note.endTime,
                });
            });
            miditrack.sort((a, b) => a._startTime - b._startTime)
            var lastTime = 0;
            miditrack.forEach(msg => {
                msg.deltaTime = (msg._startTime - lastTime) * this.numerator * this.denominator * 60;
                lastTime = msg._startTime;
            })
            miditrack.push(<MidiEndOfTrackEvent>{
                deltaTime: 0,
                type: 'endOfTrack',
            })
            if (miditrack.length > 1) {
                writeTracks.push(miditrack);
            }
            console.log('MMMMMMMMMMMMMMMMMMMM', miditrack)
        })
        writeTracks[0].unshift(<MidiSetTempoEvent>{
            deltaTime: 0,
            microsecondsPerBeat: 60_000_000 / this.tempo,
            type: 'setTempo',
        });
        writeTracks[0].unshift(<MidiTimeSignatureEvent>{
            deltaTime: 0,
            denominator: this.denominator,
            numerator: this.numerator,
            type: 'timeSignature',
        });
        const result = writeMidi({
            header: {
                format: 1,
                numTracks: writeTracks.length,
                ticksPerBeat: 960, // TODO
            },
            tracks: writeTracks
        })
        console.log(result);
        // const outputBuffer = Buffer.from(output);
        const blob = new Blob([new Int8Array(result)], { type: 'audio/midi' });
        let link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = "output.mid";
        link.click();
    }
    findChildrenTracks() {
        this._xpath('/Project/Structure//Track').forEach(node => {
            let parentTrack = this.trackById[node.getAttribute('id')];
            this._xpath('.//Track', node).forEach(childTrackEl => {
                parentTrack.children.push(this.trackById[childTrackEl.getAttribute('id')])
            })
        })
    }
    sortNotes() {
        this.tracks.forEach(track => {
            track.notes.sort((a, b) => a.startTime - b.startTime)
        })
    }
    parseXml(stringXml: string) {
        const parser = new DOMParser();
        this.doc = parser.parseFromString(stringXml, "text/xml");
    }
    findTracks() {
        this._xpath('/Project/Structure//Track').forEach(el => {
            let track: TTrack = {
                id: el.getAttribute('id'),
                name: el.getAttribute('name'),
                notes: [],
                ccList: [],
                children: [],
            };
            this.tracks.push(track);
            this.trackById[track.id] = track;
        })
    }
    findNotes() {
        this._xpath('/Project/Arrangement/Lanes/Lanes').forEach(laneEl => {
            var track = this.trackById[laneEl.getAttribute('track')]
            this.findClips(laneEl, track);
            this.findCc(laneEl, track);
        })
    }
    findCc(laneEl: Node, track: TTrack) {
        let xpath = this.doc.evaluate('./Points/Target[@expression="channelController"]', laneEl);
        let targetEl = xpath.iterateNext();
        if (!targetEl) {
            return;
        }
        let channel = parseInt(targetEl.getAttribute('channel'));
        let controller = parseInt(targetEl.getAttribute('controller'));

        this._xpath('./Points/RealPoint', laneEl).forEach(pointEl => {
            let event: TCc = {
                channel,
                controller,
                startTime: parseFloat(pointEl.getAttribute('time')),
                value: parseFloat(pointEl.getAttribute('value')) * 127
            };
            track.ccList.push(event);
            track.children.forEach(child => child.ccList.push(event));
        });
    }
    findClips(laneEl: Node, track: TTrack) {
        this._xpath('./Clips/Clip', laneEl).forEach(clipEl => {
            let clipStartTime = parseFloat(clipEl.getAttribute('time'))
            this._xpath('./Notes/Note', clipEl).forEach(noteEl => {
                let noteStartTime = clipStartTime + parseFloat(noteEl.getAttribute('time'));
                let note = {
                    channel: parseInt(noteEl.getAttribute('channel')),
                    key: parseInt(noteEl.getAttribute('key')),
                    startTime: noteStartTime,
                    endTime: noteStartTime + parseFloat(noteEl.getAttribute('duration')),
                    velocity: parseFloat(noteEl.getAttribute('vel')),
                };
                track.notes.push(note)
            });
        });
    }
}

const cb = (e) => {
    const converter = new DawprojectToMidi(document.querySelector('input#fileselect')!.files[0]);
    console.log(converter);
};
document.querySelector('input#fileselect')!.addEventListener('change', cb);