export interface TTrack {
    id: string
    name: string
    notes: Array<TNote>
    ccList: Array<TCc>
    children: Array<TTrack>
}
export interface TNote {
    startTime: number
    endTime: number
    channel: number
    key: number
    velocity: number
}
export interface TCc {
    startTime: number
    channel: number
    controller: number
    value: number
}