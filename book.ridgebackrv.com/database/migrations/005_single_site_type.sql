UPDATE site_types
SET name = 'Full Hookup Site',
    description = '50-foot concrete pad with 20/30/50A full hookups.',
    default_nightly_cents = 6500,
    is_active = 1
WHERE code = 'standard';

UPDATE site_types
SET is_active = 0
WHERE code IN ('premium', 'monthly');

UPDATE sites AS s
JOIN site_types AS st ON st.id = s.site_type_id
SET s.is_active = 0
WHERE st.code IN ('premium', 'monthly');
