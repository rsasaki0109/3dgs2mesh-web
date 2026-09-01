use mesh_core::{
    automatic_iso, cleanup_mesh, extract_mesh, make_grid, parse_ply, quantile, ConversionParams,
    Gaussian,
};
use std::{env, fs, process, time::Instant};

fn scale_ratio(gaussian: &Gaussian) -> f32 {
    let smallest = gaussian
        .scale
        .x
        .min(gaussian.scale.y)
        .min(gaussian.scale.z)
        .max(1.0e-6);
    gaussian.scale.x.max(gaussian.scale.y).max(gaussian.scale.z) / smallest
}

fn main() {
    if let Err(error) = run() {
        eprintln!("real-data inspection failed: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = env::args().collect::<Vec<_>>();
    if args.len() < 2 {
        return Err(
            "usage: inspect_real <point_cloud.ply> [resolution] [all|crop|anisotropic]".into(),
        );
    }
    let resolution = args
        .get(2)
        .and_then(|value| value.parse().ok())
        .unwrap_or(32);
    let mode = args.get(3).map(String::as_str).unwrap_or("all");
    let bytes = fs::read(&args[1])?;
    let parse_started = Instant::now();
    let parsed = parse_ply(&bytes)?;
    let source_count = parsed.len();
    let mut gaussians = parsed
        .into_iter()
        .filter(|gaussian| gaussian.opacity >= 0.02)
        .collect::<Vec<_>>();
    let opacity_count = gaussians.len();
    let ratios = gaussians.iter().map(scale_ratio).collect::<Vec<_>>();
    let ratio_p95 = quantile(ratios.clone(), 0.95);
    let ratio_p99 = quantile(ratios.clone(), 0.99);
    let ratio_max = ratios.iter().copied().fold(0.0_f32, f32::max);

    match mode {
        "all" => {}
        "anisotropic" => gaussians.retain(|gaussian| scale_ratio(gaussian) >= ratio_p95),
        "crop" => {
            let xs = gaussians.iter().map(|g| g.mean.x).collect::<Vec<_>>();
            let ys = gaussians.iter().map(|g| g.mean.y).collect::<Vec<_>>();
            let zs = gaussians.iter().map(|g| g.mean.z).collect::<Vec<_>>();
            let lower = [
                quantile(xs.clone(), 0.30),
                quantile(ys.clone(), 0.30),
                quantile(zs.clone(), 0.30),
            ];
            let upper = [quantile(xs, 0.70), quantile(ys, 0.70), quantile(zs, 0.70)];
            gaussians.retain(|g| {
                g.mean.x >= lower[0]
                    && g.mean.x <= upper[0]
                    && g.mean.y >= lower[1]
                    && g.mean.y <= upper[1]
                    && g.mean.z >= lower[2]
                    && g.mean.z <= upper[2]
            });
        }
        _ => return Err(format!("unknown mode: {mode}").into()),
    }

    let parse_ms = parse_started.elapsed().as_millis();
    let params = ConversionParams {
        resolution,
        opacity_threshold: 0.02,
        sigma_radius: 3.0,
        bounds_quantile: 0.01,
        keep_largest_component: true,
        min_component_faces: 16,
        smoothing_iterations: 1,
    };
    let voxel_started = Instant::now();
    let field = make_grid(&gaussians, &params)?;
    let voxel_ms = voxel_started.elapsed().as_millis();
    let iso = automatic_iso(field.stats);
    let mesh_started = Instant::now();
    let raw = extract_mesh(&field, &gaussians, iso, params.sigma_radius);
    let raw_triangles = raw.indices.len() / 3;
    let mesh = cleanup_mesh(
        raw,
        params.keep_largest_component,
        params.min_component_faces,
        params.smoothing_iterations,
    );
    let mesh_ms = mesh_started.elapsed().as_millis();
    println!(
        "{{\"fileBytes\":{},\"mode\":\"{}\",\"source\":{},\"opacityRetained\":{},\"caseRetained\":{},\"scaleRatioP95\":{},\"scaleRatioP99\":{},\"scaleRatioMax\":{},\"resolution\":{},\"dims\":[{},{},{}],\"voxels\":{},\"densityMax\":{},\"densityNonZero\":{},\"iso\":{},\"rawTriangles\":{},\"vertices\":{},\"triangles\":{},\"parseMs\":{},\"voxelMs\":{},\"meshMs\":{}}}",
        bytes.len(),
        mode,
        source_count,
        opacity_count,
        gaussians.len(),
        ratio_p95,
        ratio_p99,
        ratio_max,
        resolution,
        field.dims[0],
        field.dims[1],
        field.dims[2],
        field.density.len(),
        field.stats.max,
        field.stats.non_zero,
        iso,
        raw_triangles,
        mesh.positions.len() / 3,
        mesh.indices.len() / 3,
        parse_ms,
        voxel_ms,
        mesh_ms,
    );
    Ok(())
}
