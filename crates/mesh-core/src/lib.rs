//! Independent, deterministic 3DGS density-field meshing core.
//! The implementation intentionally does not depend on browser APIs.

use std::collections::{HashMap, HashSet};
use std::fmt;

pub const SH_C0: f32 = 0.282_094_8;
const EPS: f32 = 1.0e-6;

#[derive(Debug, Clone)]
pub struct CoreError(pub String);

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CoreError {}

#[derive(Clone, Copy, Debug, Default)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }
    pub fn plus(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
    pub fn minus(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
    pub fn scaled(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }
    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn cross(self, o: Self) -> Self {
        Self::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    pub fn length(self) -> f32 {
        self.dot(self).sqrt()
    }
    pub fn normalized(self) -> Self {
        let n = self.length();
        if n > EPS {
            self.scaled(1.0 / n)
        } else {
            Self::new(0.0, 0.0, 1.0)
        }
    }
    pub fn finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Gaussian {
    pub mean: Vec3,
    pub scale: Vec3,
    /// Row-major rotation matrix, mapping local to world coordinates.
    pub rotation: [f32; 9],
    pub opacity: f32,
    pub color: [f32; 3],
}

#[derive(Clone, Copy, Debug)]
pub struct RawGaussian {
    pub mean: Vec3,
    pub scale: Vec3,
    pub rotation: [f32; 4],
    pub opacity: f32,
    pub color: [f32; 3],
}

pub fn sigmoid(x: f32) -> f32 {
    if x >= 0.0 {
        1.0 / (1.0 + (-x).exp())
    } else {
        let e = x.exp();
        e / (1.0 + e)
    }
}

pub fn normalize_quaternion(q: [f32; 4]) -> [f32; 4] {
    let n = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if n.is_finite() && n > EPS {
        [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
    } else {
        [1.0, 0.0, 0.0, 0.0]
    }
}

pub fn quaternion_to_matrix(q: [f32; 4]) -> [f32; 9] {
    let [w, x, y, z] = normalize_quaternion(q);
    [
        1.0 - 2.0 * (y * y + z * z),
        2.0 * (x * y - z * w),
        2.0 * (x * z + y * w),
        2.0 * (x * y + z * w),
        1.0 - 2.0 * (x * x + z * z),
        2.0 * (y * z - x * w),
        2.0 * (x * z - y * w),
        2.0 * (y * z + x * w),
        1.0 - 2.0 * (x * x + y * y),
    ]
}

pub fn activate(raw: RawGaussian) -> Gaussian {
    Gaussian {
        mean: raw.mean,
        scale: Vec3::new(
            raw.scale.x.exp().max(EPS),
            raw.scale.y.exp().max(EPS),
            raw.scale.z.exp().max(EPS),
        ),
        rotation: quaternion_to_matrix(raw.rotation),
        opacity: sigmoid(raw.opacity),
        color: [
            raw.color[0].clamp(0.0, 1.0),
            raw.color[1].clamp(0.0, 1.0),
            raw.color[2].clamp(0.0, 1.0),
        ],
    }
}

pub fn support_half_extent(g: &Gaussian, sigma_radius: f32) -> Vec3 {
    let r = &g.rotation;
    Vec3::new(
        sigma_radius * (r[0].abs() * g.scale.x + r[1].abs() * g.scale.y + r[2].abs() * g.scale.z),
        sigma_radius * (r[3].abs() * g.scale.x + r[4].abs() * g.scale.y + r[5].abs() * g.scale.z),
        sigma_radius * (r[6].abs() * g.scale.x + r[7].abs() * g.scale.y + r[8].abs() * g.scale.z),
    )
}

#[derive(Clone, Copy, Debug)]
pub struct Bounds {
    pub min: Vec3,
    pub max: Vec3,
}

impl Bounds {
    pub fn empty() -> Self {
        Self {
            min: Vec3::new(f32::INFINITY, f32::INFINITY, f32::INFINITY),
            max: Vec3::new(f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY),
        }
    }
    pub fn include(&mut self, p: Vec3) {
        self.min.x = self.min.x.min(p.x);
        self.min.y = self.min.y.min(p.y);
        self.min.z = self.min.z.min(p.z);
        self.max.x = self.max.x.max(p.x);
        self.max.y = self.max.y.max(p.y);
        self.max.z = self.max.z.max(p.z);
    }
    pub fn expand(&mut self, h: Vec3) {
        self.include(self.min.minus(h));
        self.include(self.max.plus(h));
    }
    pub fn extent(self) -> Vec3 {
        self.max.minus(self.min)
    }
    pub fn valid(self) -> bool {
        self.min.finite()
            && self.max.finite()
            && self.max.x > self.min.x
            && self.max.y > self.min.y
            && self.max.z > self.min.z
    }
}

#[derive(Clone, Debug)]
pub struct ConversionParams {
    pub resolution: u32,
    pub opacity_threshold: f32,
    pub sigma_radius: f32,
    pub bounds_quantile: f32,
    pub keep_largest_component: bool,
    pub min_component_faces: usize,
    pub smoothing_iterations: u32,
}

impl Default for ConversionParams {
    fn default() -> Self {
        Self {
            resolution: 96,
            opacity_threshold: 0.02,
            sigma_radius: 3.0,
            bounds_quantile: 0.01,
            keep_largest_component: true,
            min_component_faces: 16,
            smoothing_iterations: 1,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct DensityStats {
    pub min: f32,
    pub max: f32,
    pub non_zero: u32,
    pub histogram: [u32; 32],
}

#[derive(Clone, Debug)]
pub struct GridField {
    pub dims: [u32; 3],
    pub bounds: Bounds,
    pub spacing: f32,
    pub density: Vec<f32>,
    pub stats: DensityStats,
    pub index: SpatialIndex,
}

#[derive(Clone, Debug)]
pub struct SpatialIndex {
    pub tile_edge: u32,
    pub tile_dims: [u32; 3],
    pub buckets: Vec<Vec<usize>>,
}

impl SpatialIndex {
    fn tile_id(&self, x: u32, y: u32, z: u32) -> usize {
        ((z * self.tile_dims[1] + y) * self.tile_dims[0] + x) as usize
    }
    pub fn candidates_for_grid(&self, x: u32, y: u32, z: u32) -> &[usize] {
        let tx = (x / self.tile_edge).min(self.tile_dims[0] - 1);
        let ty = (y / self.tile_edge).min(self.tile_dims[1] - 1);
        let tz = (z / self.tile_edge).min(self.tile_dims[2] - 1);
        &self.buckets[self.tile_id(tx, ty, tz)]
    }
    pub fn candidates_for_point(&self, p: Vec3, bounds: Bounds, spacing: f32) -> &[usize] {
        let x = ((p.x - bounds.min.x) / spacing).floor().max(0.0) as u32;
        let y = ((p.y - bounds.min.y) / spacing).floor().max(0.0) as u32;
        let z = ((p.z - bounds.min.z) / spacing).floor().max(0.0) as u32;
        self.candidates_for_grid(x, y, z)
    }
}

pub fn quantile(mut values: Vec<f32>, q: f32) -> f32 {
    values.retain(|v| v.is_finite());
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let i = ((values.len() - 1) as f32 * q.clamp(0.0, 1.0)).round() as usize;
    values[i]
}

pub fn robust_bounds(
    gaussians: &[Gaussian],
    params: &ConversionParams,
) -> Result<Bounds, CoreError> {
    if gaussians.is_empty() {
        return Err(CoreError(
            "No usable Gaussians remain after filtering".into(),
        ));
    }
    let q = params.bounds_quantile.clamp(0.0, 0.49);
    let mut xs = Vec::with_capacity(gaussians.len());
    let mut ys = Vec::with_capacity(gaussians.len());
    let mut zs = Vec::with_capacity(gaussians.len());
    for g in gaussians {
        xs.push(g.mean.x);
        ys.push(g.mean.y);
        zs.push(g.mean.z);
    }
    let center_min = Vec3::new(
        quantile(xs.clone(), q),
        quantile(ys.clone(), q),
        quantile(zs.clone(), q),
    );
    let center_max = Vec3::new(
        quantile(xs, 1.0 - q),
        quantile(ys, 1.0 - q),
        quantile(zs, 1.0 - q),
    );
    let mut b = Bounds::empty();
    for g in gaussians {
        if g.mean.x >= center_min.x
            && g.mean.x <= center_max.x
            && g.mean.y >= center_min.y
            && g.mean.y <= center_max.y
            && g.mean.z >= center_min.z
            && g.mean.z <= center_max.z
        {
            let h = support_half_extent(g, params.sigma_radius);
            b.include(g.mean.minus(h));
            b.include(g.mean.plus(h));
        }
    }
    if !b.valid() {
        for g in gaussians {
            let h = support_half_extent(g, params.sigma_radius);
            b.include(g.mean.minus(h));
            b.include(g.mean.plus(h));
        }
    }
    let e = b.extent();
    let pad = Vec3::new(
        e.x.max(EPS) * 0.01,
        e.y.max(EPS) * 0.01,
        e.z.max(EPS) * 0.01,
    );
    b.expand(pad);
    Ok(b)
}

pub fn make_grid(
    gaussians: &[Gaussian],
    params: &ConversionParams,
) -> Result<GridField, CoreError> {
    let bounds = robust_bounds(gaussians, params)?;
    let extent = bounds.extent();
    let longest = extent.x.max(extent.y).max(extent.z).max(EPS);
    let spacing = longest / params.resolution.max(2) as f32;
    let dims = [
        ((extent.x / spacing).ceil() as u32 + 1).min(512),
        ((extent.y / spacing).ceil() as u32 + 1).min(512),
        ((extent.z / spacing).ceil() as u32 + 1).min(512),
    ];
    let count = dims[0] as usize * dims[1] as usize * dims[2] as usize;
    if count == 0 || count > 80_000_000 {
        return Err(CoreError(format!(
            "Grid allocation would require {} voxels; lower the resolution or crop the scene",
            count
        )));
    }
    let tile_edge = 8;
    let tile_dims = [
        dims[0].div_ceil(tile_edge),
        dims[1].div_ceil(tile_edge),
        dims[2].div_ceil(tile_edge),
    ];
    let mut buckets =
        vec![Vec::new(); tile_dims[0] as usize * tile_dims[1] as usize * tile_dims[2] as usize];
    for (i, g) in gaussians.iter().enumerate() {
        let h = support_half_extent(g, params.sigma_radius);
        let mn = g.mean.minus(h);
        let mx = g.mean.plus(h);
        let lo = [
            ((mn.x - bounds.min.x) / spacing).floor().max(0.0) as u32 / tile_edge,
            ((mn.y - bounds.min.y) / spacing).floor().max(0.0) as u32 / tile_edge,
            ((mn.z - bounds.min.z) / spacing).floor().max(0.0) as u32 / tile_edge,
        ];
        let hi = [
            ((mx.x - bounds.min.x) / spacing).ceil().max(0.0) as u32 / tile_edge,
            ((mx.y - bounds.min.y) / spacing).ceil().max(0.0) as u32 / tile_edge,
            ((mx.z - bounds.min.z) / spacing).ceil().max(0.0) as u32 / tile_edge,
        ];
        for tz in lo[2].min(tile_dims[2] - 1)..=hi[2].min(tile_dims[2] - 1) {
            for ty in lo[1].min(tile_dims[1] - 1)..=hi[1].min(tile_dims[1] - 1) {
                for tx in lo[0].min(tile_dims[0] - 1)..=hi[0].min(tile_dims[0] - 1) {
                    buckets[((tz * tile_dims[1] + ty) * tile_dims[0] + tx) as usize].push(i);
                }
            }
        }
    }
    for bucket in &mut buckets {
        bucket.sort_unstable();
        bucket.dedup();
    }
    let index = SpatialIndex {
        tile_edge,
        tile_dims,
        buckets,
    };
    let mut density = vec![0.0; count];
    let mut stats = DensityStats {
        min: f32::INFINITY,
        max: 0.0,
        non_zero: 0,
        histogram: [0; 32],
    };
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let p = Vec3::new(
                    bounds.min.x + x as f32 * spacing,
                    bounds.min.y + y as f32 * spacing,
                    bounds.min.z + z as f32 * spacing,
                );
                let mut value = 0.0;
                for &i in index.candidates_for_grid(x, y, z) {
                    value += gaussian_density(&gaussians[i], p, params.sigma_radius);
                }
                let id = ((z * dims[1] + y) * dims[0] + x) as usize;
                density[id] = value;
                stats.min = stats.min.min(value);
                stats.max = stats.max.max(value);
                if value > 0.0 {
                    stats.non_zero += 1;
                }
            }
        }
    }
    if stats.min == f32::INFINITY {
        stats.min = 0.0;
    }
    let range = (stats.max - stats.min).max(EPS);
    for &v in &density {
        if v > 0.0 {
            let bin = (((v - stats.min) / range) * 31.0).floor().clamp(0.0, 31.0) as usize;
            stats.histogram[bin] += 1;
        }
    }
    Ok(GridField {
        dims,
        bounds,
        spacing,
        density,
        stats,
        index,
    })
}

pub fn gaussian_density(g: &Gaussian, p: Vec3, sigma_radius: f32) -> f32 {
    let d = p.minus(g.mean);
    let r = &g.rotation;
    let u = Vec3::new(
        r[0] * d.x + r[3] * d.y + r[6] * d.z,
        r[1] * d.x + r[4] * d.y + r[7] * d.z,
        r[2] * d.x + r[5] * d.y + r[8] * d.z,
    );
    let d2 = (u.x / g.scale.x).powi(2) + (u.y / g.scale.y).powi(2) + (u.z / g.scale.z).powi(2);
    if d2 <= sigma_radius * sigma_radius {
        g.opacity * (-0.5 * d2).exp()
    } else {
        0.0
    }
}

pub fn automatic_iso(stats: DensityStats) -> f32 {
    if stats.max <= 0.0 {
        return 0.0;
    }
    let target = (stats.non_zero as f32 * 0.55).ceil() as u32;
    let mut acc = 0;
    let range = (stats.max - stats.min).max(EPS);
    for (i, n) in stats.histogram.iter().enumerate() {
        acc += *n;
        if acc >= target {
            // Use the bin midpoint. Returning its lower edge makes the first
            // bin select an iso value of zero for sparse real-world fields,
            // which cannot produce an edge crossing against a zero exterior.
            return stats.min + range * ((i as f32 + 0.5) / stats.histogram.len() as f32);
        }
    }
    stats.max * 0.2
}

fn idx(d: [u32; 3], x: u32, y: u32, z: u32) -> usize {
    ((z * d[1] + y) * d[0] + x) as usize
}
fn grid_point(field: &GridField, x: u32, y: u32, z: u32) -> Vec3 {
    Vec3::new(
        field.bounds.min.x + x as f32 * field.spacing,
        field.bounds.min.y + y as f32 * field.spacing,
        field.bounds.min.z + z as f32 * field.spacing,
    )
}
fn gradient(field: &GridField, x: u32, y: u32, z: u32) -> Vec3 {
    let d = field.dims;
    let xm = x.saturating_sub(1);
    let xp = (x + 1).min(d[0] - 1);
    let ym = y.saturating_sub(1);
    let yp = (y + 1).min(d[1] - 1);
    let zm = z.saturating_sub(1);
    let zp = (z + 1).min(d[2] - 1);
    Vec3::new(
        (field.density[idx(d, xp, y, z)] - field.density[idx(d, xm, y, z)])
            / ((xp - xm).max(1) as f32 * field.spacing),
        (field.density[idx(d, x, yp, z)] - field.density[idx(d, x, ym, z)])
            / ((yp - ym).max(1) as f32 * field.spacing),
        (field.density[idx(d, x, y, zp)] - field.density[idx(d, x, y, zm)])
            / ((zp - zm).max(1) as f32 * field.spacing),
    )
}

#[derive(Clone, Debug, Default)]
pub struct Mesh {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub colors: Vec<f32>,
    pub indices: Vec<u32>,
}

fn color_at(field: &GridField, gaussians: &[Gaussian], p: Vec3, sigma: f32) -> [f32; 3] {
    let mut c = [0.0; 3];
    let mut w = 0.0;
    let mut seen = HashSet::new();
    for &i in field
        .index
        .candidates_for_point(p, field.bounds, field.spacing)
    {
        if seen.insert(i) {
            let a = gaussian_density(&gaussians[i], p, sigma);
            w += a;
            c[0] += a * gaussians[i].color[0];
            c[1] += a * gaussians[i].color[1];
            c[2] += a * gaussians[i].color[2];
        }
    }
    if w > EPS {
        [c[0] / w, c[1] / w, c[2] / w]
    } else {
        [0.55, 0.58, 0.62]
    }
}

pub fn extract_mesh(field: &GridField, gaussians: &[Gaussian], iso: f32, sigma: f32) -> Mesh {
    let mut mesh = Mesh::default();
    let mut edges: HashMap<(usize, usize), u32> = HashMap::new();
    let tetra = [
        [0usize, 5, 1, 6],
        [0, 1, 2, 6],
        [0, 2, 3, 6],
        [0, 3, 7, 6],
        [0, 7, 4, 6],
        [0, 4, 5, 6],
    ];
    let cube_offsets = [
        (0, 0, 0),
        (1, 0, 0),
        (1, 1, 0),
        (0, 1, 0),
        (0, 0, 1),
        (1, 0, 1),
        (1, 1, 1),
        (0, 1, 1),
    ];
    let mut add_vertex = |a: (u32, u32, u32),
                          b: (u32, u32, u32),
                          pa: Vec3,
                          pb: Vec3,
                          va: f32,
                          vb: f32,
                          ga: Vec3,
                          gb: Vec3|
     -> u32 {
        let ia = idx(field.dims, a.0, a.1, a.2);
        let ib = idx(field.dims, b.0, b.1, b.2);
        let key = if ia < ib { (ia, ib) } else { (ib, ia) };
        if let Some(v) = edges.get(&key) {
            return *v;
        }
        let t = ((iso - va) / (vb - va)).clamp(0.0, 1.0);
        let p = pa.plus(pb.minus(pa).scaled(t));
        let g = ga.plus(gb.minus(ga).scaled(t)).scaled(-1.0).normalized();
        let color = color_at(field, gaussians, p, sigma);
        let id = (mesh.positions.len() / 3) as u32;
        mesh.positions.extend_from_slice(&[p.x, p.y, p.z]);
        mesh.normals.extend_from_slice(&[g.x, g.y, g.z]);
        mesh.colors.extend_from_slice(&color);
        edges.insert(key, id);
        id
    };
    for z in 0..field.dims[2].saturating_sub(1) {
        for y in 0..field.dims[1].saturating_sub(1) {
            for x in 0..field.dims[0].saturating_sub(1) {
                let mut p = [Vec3::default(); 8];
                let mut v = [0.0; 8];
                let mut g = [Vec3::default(); 8];
                for i in 0..8 {
                    let (dx, dy, dz) = cube_offsets[i];
                    let q = (x + dx, y + dy, z + dz);
                    p[i] = grid_point(field, q.0, q.1, q.2);
                    v[i] = field.density[idx(field.dims, q.0, q.1, q.2)];
                    g[i] = gradient(field, q.0, q.1, q.2);
                }
                for tet in tetra {
                    let mut inside = [false; 4];
                    for j in 0..4 {
                        inside[j] = v[tet[j]] >= iso;
                    }
                    let count = inside.iter().filter(|x| **x).count();
                    if count == 0 || count == 4 {
                        continue;
                    }
                    let mut cross: Vec<(usize, usize)> = Vec::new();
                    for a in 0..4 {
                        for b in (a + 1)..4 {
                            if inside[a] != inside[b] {
                                cross.push((tet[a], tet[b]));
                            }
                        }
                    }
                    let mut verts = Vec::new();
                    for (ea, eb) in cross {
                        let ca = cube_offsets[ea];
                        let cb = cube_offsets[eb];
                        verts.push(add_vertex(
                            (x + ca.0, y + ca.1, z + ca.2),
                            (x + cb.0, y + cb.1, z + cb.2),
                            p[ea],
                            p[eb],
                            v[ea],
                            v[eb],
                            g[ea],
                            g[eb],
                        ));
                    }
                    if verts.len() == 3 {
                        mesh.indices
                            .extend_from_slice(&[verts[0], verts[1], verts[2]]);
                    } else if verts.len() == 4 {
                        mesh.indices.extend_from_slice(&[
                            verts[0], verts[1], verts[2], verts[0], verts[2], verts[3],
                        ]);
                    }
                }
            }
        }
    }
    mesh
}

pub fn cleanup_mesh(
    mut mesh: Mesh,
    keep_largest: bool,
    min_faces: usize,
    smoothing_iterations: u32,
) -> Mesh {
    let face_count = mesh.indices.len() / 3;
    if face_count == 0 {
        return mesh;
    }
    let mut adjacency = vec![Vec::<usize>::new(); face_count];
    let mut by_vertex: HashMap<u32, Vec<usize>> = HashMap::new();
    for f in 0..face_count {
        for j in 0..3 {
            by_vertex
                .entry(mesh.indices[f * 3 + j])
                .or_default()
                .push(f);
        }
    }
    for faces in by_vertex.values() {
        for &a in faces {
            for &b in faces {
                if a != b {
                    adjacency[a].push(b);
                }
            }
        }
    }
    for a in &mut adjacency {
        a.sort_unstable();
        a.dedup();
    }
    let mut comp = vec![usize::MAX; face_count];
    let mut sizes = Vec::new();
    let mut cid = 0;
    for s in 0..face_count {
        if comp[s] != usize::MAX {
            continue;
        }
        let mut st = vec![s];
        comp[s] = cid;
        let mut n = 0;
        while let Some(f) = st.pop() {
            n += 1;
            for &q in &adjacency[f] {
                if comp[q] == usize::MAX {
                    comp[q] = cid;
                    st.push(q);
                }
            }
        }
        sizes.push(n);
        cid += 1;
    }
    let largest = sizes
        .iter()
        .enumerate()
        .max_by_key(|(_, n)| **n)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let mut keep = vec![false; face_count];
    for (f, keep_face) in keep.iter_mut().enumerate() {
        *keep_face = sizes[comp[f]] >= min_faces && (!keep_largest || comp[f] == largest);
    }
    let mut used = HashSet::new();
    let mut inds = Vec::new();
    for (f, keep_face) in keep.iter().enumerate() {
        if *keep_face {
            for j in 0..3 {
                let v = mesh.indices[f * 3 + j];
                used.insert(v);
                inds.push(v);
            }
        }
    }
    let mut map = HashMap::new();
    let mut pos = Vec::new();
    let mut nor = Vec::new();
    let mut col = Vec::new();
    for old in used.iter().copied() {
        let n = (pos.len() / 3) as u32;
        map.insert(old, n);
        pos.extend_from_slice(&mesh.positions[old as usize * 3..old as usize * 3 + 3]);
        nor.extend_from_slice(&mesh.normals[old as usize * 3..old as usize * 3 + 3]);
        col.extend_from_slice(&mesh.colors[old as usize * 3..old as usize * 3 + 3]);
    }
    for v in &mut inds {
        *v = *map.get(v).unwrap();
    }
    mesh.positions = pos;
    mesh.normals = nor;
    mesh.colors = col;
    mesh.indices = inds;
    if smoothing_iterations > 0 && !mesh.positions.is_empty() {
        smooth_taubin(&mut mesh, smoothing_iterations);
        recompute_normals(&mut mesh);
    }
    mesh
}

pub fn smooth_taubin(mesh: &mut Mesh, iterations: u32) {
    let n = mesh.positions.len() / 3;
    let mut neighbours = vec![HashSet::new(); n];
    for f in mesh.indices.as_chunks::<3>().0 {
        for a in f {
            for b in f {
                if a != b {
                    neighbours[*a as usize].insert(*b as usize);
                }
            }
        }
    }
    for _ in 0..iterations {
        for &(lambda, sign) in &[(0.33f32, 1.0f32), (-0.34f32, -1.0f32)] {
            let mut next = mesh.positions.clone();
            for i in 0..n {
                if neighbours[i].is_empty() {
                    continue;
                }
                let mut avg = Vec3::default();
                for &j in &neighbours[i] {
                    avg = avg.plus(Vec3::new(
                        mesh.positions[j * 3],
                        mesh.positions[j * 3 + 1],
                        mesh.positions[j * 3 + 2],
                    ));
                }
                avg = avg.scaled(1.0 / neighbours[i].len() as f32);
                let p = Vec3::new(
                    mesh.positions[i * 3],
                    mesh.positions[i * 3 + 1],
                    mesh.positions[i * 3 + 2],
                );
                let q = p.plus(avg.minus(p).scaled(lambda * sign));
                next[i * 3] = q.x;
                next[i * 3 + 1] = q.y;
                next[i * 3 + 2] = q.z;
            }
            mesh.positions = next;
        }
    }
}
pub fn recompute_normals(mesh: &mut Mesh) {
    mesh.normals.fill(0.0);
    for f in mesh.indices.as_chunks::<3>().0 {
        let a = f[0] as usize * 3;
        let b = f[1] as usize * 3;
        let c = f[2] as usize * 3;
        let p = Vec3::new(
            mesh.positions[a],
            mesh.positions[a + 1],
            mesh.positions[a + 2],
        );
        let q = Vec3::new(
            mesh.positions[b],
            mesh.positions[b + 1],
            mesh.positions[b + 2],
        );
        let r = Vec3::new(
            mesh.positions[c],
            mesh.positions[c + 1],
            mesh.positions[c + 2],
        );
        let n = q.minus(p).cross(r.minus(p));
        for i in [a, b, c] {
            mesh.normals[i] += n.x;
            mesh.normals[i + 1] += n.y;
            mesh.normals[i + 2] += n.z;
        }
    }
    for n in mesh.normals.as_chunks_mut::<3>().0 {
        let v = Vec3::new(n[0], n[1], n[2]).normalized();
        n[0] = v.x;
        n[1] = v.y;
        n[2] = v.z;
    }
}

pub fn mesh_to_ply(mesh: &Mesh) -> Vec<u8> {
    let mut out=format!("ply\nformat binary_little_endian 1.0\nelement vertex {}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face {}\nproperty list uchar int vertex_indices\nend_header\n",mesh.positions.len()/3,mesh.indices.len()/3).into_bytes();
    for i in 0..mesh.positions.len() / 3 {
        for v in [
            mesh.positions[i * 3],
            mesh.positions[i * 3 + 1],
            mesh.positions[i * 3 + 2],
            mesh.normals[i * 3],
            mesh.normals[i * 3 + 1],
            mesh.normals[i * 3 + 2],
        ] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        for c in mesh.colors[i * 3..i * 3 + 3].iter() {
            out.push((c.clamp(0.0, 1.0) * 255.0).round() as u8);
        }
    }
    for f in mesh.indices.as_chunks::<3>().0 {
        out.push(3);
        for v in f {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum PlyType {
    U8,
    U16,
    U32,
    I8,
    I16,
    I32,
    F32,
    F64,
}
impl PlyType {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "uchar" | "uint8" => Some(Self::U8),
            "ushort" | "uint16" => Some(Self::U16),
            "uint" | "uint32" => Some(Self::U32),
            "char" | "int8" => Some(Self::I8),
            "short" | "int16" => Some(Self::I16),
            "int" | "int32" => Some(Self::I32),
            "float" | "float32" => Some(Self::F32),
            "double" | "float64" => Some(Self::F64),
            _ => None,
        }
    }
    fn size(self) -> usize {
        match self {
            Self::U8 | Self::I8 => 1,
            Self::U16 | Self::I16 => 2,
            Self::U32 | Self::I32 | Self::F32 => 4,
            Self::F64 => 8,
        }
    }
}

#[derive(Clone, Debug)]
struct PlyProp {
    name: String,
    kind: PlyType,
}
pub fn parse_ply(bytes: &[u8]) -> Result<Vec<Gaussian>, CoreError> {
    let marker = b"end_header";
    let marker_end = bytes
        .windows(marker.len())
        .position(|window| window == marker)
        .map(|position| position + marker.len())
        .ok_or_else(|| CoreError("PLY header is missing end_header".into()))?;
    let end = if bytes.get(marker_end..marker_end + 2) == Some(b"\r\n") {
        marker_end + 2
    } else if bytes.get(marker_end) == Some(&b'\n') {
        marker_end + 1
    } else {
        return Err(CoreError(
            "PLY end_header must be followed by a line ending".into(),
        ));
    };
    let header = std::str::from_utf8(&bytes[..end])
        .map_err(|_| CoreError("PLY header is not UTF-8".into()))?;
    let mut format = "";
    let mut vertex_count = 0usize;
    let mut in_vertex = false;
    let mut props = Vec::new();
    let mut vertex_seen = false;
    for line in header.lines() {
        let p: Vec<_> = line.split_whitespace().collect();
        if p.is_empty() {
            continue;
        }
        match p[0] {
            "format" => {
                format = p.get(1).copied().unwrap_or("");
            }
            "element" => {
                in_vertex = p.get(1) == Some(&"vertex");
                if in_vertex {
                    vertex_seen = true;
                    vertex_count = p.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
                }
            }
            "property" if in_vertex => {
                if p.get(1) == Some(&"list") {
                    return Err(CoreError(
                        "Unsupported list property in vertex element".into(),
                    ));
                }
                let kind = PlyType::parse(p.get(1).copied().unwrap_or("")).ok_or_else(|| {
                    CoreError(format!(
                        "Unsupported PLY scalar type: {}",
                        p.get(1).unwrap_or(&"")
                    ))
                })?;
                props.push(PlyProp {
                    name: p.get(2).unwrap_or(&"").to_string(),
                    kind,
                });
            }
            _ => {}
        }
    }
    if !vertex_seen || vertex_count == 0 {
        return Err(CoreError(
            "PLY must contain a non-empty vertex element".into(),
        ));
    }
    if format == "binary_big_endian" {
        return Err(CoreError(
            "binary_big_endian PLY is not supported; export little-endian or ASCII".into(),
        ));
    }
    if format != "ascii" && format != "binary_little_endian" {
        return Err(CoreError(format!("Unsupported PLY format: {}", format)));
    }
    let required = [
        "x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2",
        "rot_3",
    ];
    let missing: Vec<_> = required
        .iter()
        .filter(|n| !props.iter().any(|p| p.name == **n))
        .copied()
        .collect();
    if !missing.is_empty() {
        return Err(CoreError(format!(
            "Missing required PLY properties: {}",
            missing.join(", ")
        )));
    }
    let pi: HashMap<_, _> = props
        .iter()
        .enumerate()
        .map(|(i, p)| (p.name.as_str(), i))
        .collect();
    let mut out = Vec::with_capacity(vertex_count);
    if format == "ascii" {
        let text = std::str::from_utf8(&bytes[end..])
            .map_err(|_| CoreError("ASCII PLY data is not UTF-8".into()))?;
        let mut lines = text.lines();
        for row in 0..vertex_count {
            let vals: Vec<_> = lines
                .next()
                .ok_or_else(|| CoreError(format!("PLY is truncated at vertex {}", row)))?
                .split_whitespace()
                .collect();
            if vals.len() < props.len() {
                return Err(CoreError(format!(
                    "PLY vertex {} has {} values; expected {}",
                    row,
                    vals.len(),
                    props.len()
                )));
            }
            let get = |name: &str| -> Result<f32, CoreError> {
                vals[*pi.get(name).unwrap()]
                    .parse::<f64>()
                    .map(|v| v as f32)
                    .map_err(|_| {
                        CoreError(format!(
                            "Invalid numeric value for {} at vertex {}",
                            name, row
                        ))
                    })
            };
            let color = [
                pi.get("f_dc_0")
                    .and_then(|i| vals[*i].parse::<f32>().ok())
                    .map(|v| 0.5 + SH_C0 * v)
                    .unwrap_or(0.55),
                pi.get("f_dc_1")
                    .and_then(|i| vals[*i].parse::<f32>().ok())
                    .map(|v| 0.5 + SH_C0 * v)
                    .unwrap_or(0.58),
                pi.get("f_dc_2")
                    .and_then(|i| vals[*i].parse::<f32>().ok())
                    .map(|v| 0.5 + SH_C0 * v)
                    .unwrap_or(0.62),
            ];
            let raw = RawGaussian {
                mean: Vec3::new(get("x")?, get("y")?, get("z")?),
                scale: Vec3::new(get("scale_0")?, get("scale_1")?, get("scale_2")?),
                rotation: [get("rot_0")?, get("rot_1")?, get("rot_2")?, get("rot_3")?],
                opacity: get("opacity")?,
                color,
            };
            if !raw.mean.finite()
                || !raw.scale.finite()
                || !raw.opacity.is_finite()
                || raw.rotation.iter().any(|value| !value.is_finite())
                || raw.color.iter().any(|value| !value.is_finite())
            {
                continue;
            }
            out.push(activate(raw));
        }
    } else {
        let mut cursor = end;
        for row in 0..vertex_count {
            let mut vals = vec![0f32; props.len()];
            for (i, p) in props.iter().enumerate() {
                let n = p.kind.size();
                if cursor + n > bytes.len() {
                    return Err(CoreError(format!("PLY is truncated at vertex {}", row)));
                }
                vals[i] = match p.kind {
                    PlyType::U8 => bytes[cursor] as f32,
                    PlyType::I8 => (bytes[cursor] as i8) as f32,
                    PlyType::U16 => u16::from_le_bytes([bytes[cursor], bytes[cursor + 1]]) as f32,
                    PlyType::I16 => i16::from_le_bytes([bytes[cursor], bytes[cursor + 1]]) as f32,
                    PlyType::U32 => {
                        u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as f32
                    }
                    PlyType::I32 => {
                        i32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as f32
                    }
                    PlyType::F32 => {
                        f32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap())
                    }
                    PlyType::F64 => {
                        f64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap()) as f32
                    }
                };
                cursor += n;
            }
            let get = |name: &str| vals[*pi.get(name).unwrap()];
            let color = [
                pi.get("f_dc_0")
                    .map(|i| 0.5 + SH_C0 * vals[*i])
                    .unwrap_or(0.55),
                pi.get("f_dc_1")
                    .map(|i| 0.5 + SH_C0 * vals[*i])
                    .unwrap_or(0.58),
                pi.get("f_dc_2")
                    .map(|i| 0.5 + SH_C0 * vals[*i])
                    .unwrap_or(0.62),
            ];
            let raw = RawGaussian {
                mean: Vec3::new(get("x"), get("y"), get("z")),
                scale: Vec3::new(get("scale_0"), get("scale_1"), get("scale_2")),
                rotation: [get("rot_0"), get("rot_1"), get("rot_2"), get("rot_3")],
                opacity: get("opacity"),
                color,
            };
            if !raw.mean.finite()
                || !raw.scale.finite()
                || !raw.opacity.is_finite()
                || raw.rotation.iter().any(|value| !value.is_finite())
                || raw.color.iter().any(|value| !value.is_finite())
            {
                continue;
            }
            out.push(activate(raw));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn g() -> Gaussian {
        activate(RawGaussian {
            mean: Vec3::default(),
            scale: Vec3::new(0.0, 0.0, 0.0),
            rotation: [1.0, 0.0, 0.0, 0.0],
            opacity: 0.0,
            color: [1.0, 0.0, 0.0],
        })
    }
    #[test]
    fn activation() {
        assert!((sigmoid(0.0) - 0.5).abs() < 1e-6);
        assert!((g().scale.x - 1.0).abs() < 1e-6);
        assert_eq!(g().rotation, [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
    }
    #[test]
    fn identity_rotation() {
        let m = quaternion_to_matrix([1.0, 0.0, 0.0, 0.0]);
        assert_eq!(m, [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
    }
    #[test]
    fn support_and_symmetry() {
        let a = g();
        assert!((support_half_extent(&a, 3.0).x - 3.0).abs() < 1e-6);
        assert!(
            (gaussian_density(&a, Vec3::new(0.2, 0.0, 0.0), 3.0)
                - gaussian_density(&a, Vec3::new(-0.2, 0.0, 0.0), 3.0))
            .abs()
                < 1e-6
        );
    }
    #[test]
    fn mesh_sphere_like() {
        let gs = vec![g()];
        let f = make_grid(
            &gs,
            &ConversionParams {
                resolution: 20,
                opacity_threshold: 0.0,
                ..Default::default()
            },
        )
        .unwrap();
        let m = extract_mesh(&f, &gs, automatic_iso(f.stats), 3.0);
        assert!(!m.indices.is_empty());
        for n in m.normals {
            assert!(n.is_finite());
        }
    }
    #[test]
    fn automatic_iso_is_positive_for_sparse_first_bin() {
        let mut histogram = [0; 32];
        histogram[0] = 100;
        let iso = automatic_iso(DensityStats {
            min: 0.0,
            max: 1.0,
            non_zero: 100,
            histogram,
        });
        assert!(iso > 0.0 && iso < 1.0);
    }
    #[test]
    fn cleanup_components() {
        let m = Mesh {
            positions: vec![
                0., 0., 0., 1., 0., 0., 0., 1., 0., 10., 0., 0., 11., 0., 0., 10., 1., 0.,
            ],
            normals: vec![0.; 18],
            colors: vec![1.; 18],
            indices: vec![0, 1, 2, 3, 4, 5],
        };
        let c = cleanup_mesh(m, true, 1, 0);
        assert_eq!(c.indices.len(), 3);
    }
    #[test]
    fn ply_header() {
        let m = Mesh {
            positions: vec![0., 0., 0.],
            normals: vec![0., 0., 1.],
            colors: vec![1., 0., 0.],
            indices: vec![],
        };
        let p = mesh_to_ply(&m);
        let h = std::str::from_utf8(&p[..p.iter().position(|b| *b == b'\n').unwrap_or(0)]).unwrap();
        assert_eq!(h, "ply");
        assert!(String::from_utf8_lossy(&p).contains("element vertex 1"));
    }
}
