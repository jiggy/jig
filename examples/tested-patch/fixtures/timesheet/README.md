# Timesheet minutes

A source-local Bun CLI totals `HH:MM-HH:MM` lines from stdin. Overnight shifts
cross midnight; an equal start/end means zero minutes. Invalid hours/minutes
must fail. Two intentional defects allow invalid minutes and discard overnight
durations. Candidate variants execute only through Jig's contained commands.
