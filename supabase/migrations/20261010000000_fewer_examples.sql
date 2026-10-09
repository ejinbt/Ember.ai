-- Fewer example lanterns: 35 -> 24. Each petal of the flower keeps its inner 4 (the outer ones go,
-- with their replies), so the flower keeps its shape, just more compact.
delete from public.thoughts
where is_example
  and id in (select md5('ember-seed:' || x)::uuid from unnest(array['thought_example_15', 'thought_example_16', 'thought_example_19', 'thought_example_20', 'thought_example_23', 'thought_example_26', 'thought_example_27', 'thought_example_30', 'thought_example_31', 'thought_example_34', 'thought_example_35']) as x);
