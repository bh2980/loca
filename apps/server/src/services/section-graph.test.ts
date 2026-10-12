import { describe, expect, it } from 'vitest';
import { assignSections, sectionJobs, type SectionNode } from './section-graph.ts';

const node = (id: string, section: string | null): SectionNode => ({ id, width: 10, height: 10, section });

describe('section graph', () => {
  it('puts a choice with the section it is offered in, else where it leads', () => {
    const nodes = [node('a', 'Day 1'), node('choice', null), node('b', 'Day 2'), node('orphan-choice', null), node('c', 'Day 2'), node('alone', null)];
    const edges = [
      { from: 'a', to: 'choice' },
      { from: 'choice', to: 'b' },
      { from: 'orphan-choice', to: 'c' },
    ];
    const section = assignSections(nodes, edges);
    expect(section.get('choice')).toBe('Day 1');
    expect(section.get('orphan-choice')).toBe('Day 2');
    expect(section.get('alone')).toBe('(장면 밖)');
  });

  it('lays out each section on its own with portals for the edges between them', () => {
    const nodes = [node('a', 'Day 1'), node('b', 'Day 1'), node('c', 'Day 2'), node('d', 'Day 2')];
    const edges = [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'b', to: 'c' },
      { id: 'e3', from: 'a', to: 'd' },
      { id: 'e4', from: 'c', to: 'd' },
    ];
    const jobs = sectionJobs(nodes, edges, ['Day 1', 'Day 2']);
    expect(jobs.map((job) => job.name)).toEqual(['Day 1', 'Day 2']);
    const [day1, day2] = jobs;
    expect(day1.portals).toEqual([{ id: 'portal:out:Day 2', section: 'Day 2', direction: 'out' }]);
    expect(day1.job.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(['a>b', 'b>portal:out:Day 2', 'a>portal:out:Day 2']);
    expect(day2.portals).toEqual([{ id: 'portal:in:Day 1', section: 'Day 1', direction: 'in' }]);
    expect(day2.job.nodes.map((entry) => entry.id).sort()).toEqual(['c', 'd', 'portal:in:Day 1']);
  });
});
