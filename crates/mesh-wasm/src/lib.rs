use js_sys::{Float32Array, Uint32Array, Uint8Array};
use mesh_core::{
    automatic_iso, cleanup_mesh, extract_mesh, make_grid, mesh_to_ply, parse_ply, ConversionParams,
    Gaussian, GridField, Mesh, Vec3,
};
use wasm_bindgen::prelude::*;

fn js_error(message: impl ToString) -> JsValue {
    JsValue::from_str(&message.to_string())
}

#[wasm_bindgen]
pub struct ConversionSession {
    gaussians: Vec<Gaussian>,
    params: ConversionParams,
    field: Option<GridField>,
    mesh: Option<Mesh>,
    iso: f32,
    input_count: usize,
}

#[wasm_bindgen]
impl ConversionSession {
    #[wasm_bindgen(constructor)]
    pub fn new(
        bytes: &[u8],
        resolution: u32,
        opacity_threshold: f32,
        sigma_radius: f32,
        bounds_quantile: f32,
    ) -> Result<ConversionSession, JsValue> {
        let parsed = parse_ply(bytes).map_err(js_error)?;
        let input_count = parsed.len();
        let threshold = opacity_threshold.clamp(0.0, 1.0);
        let gaussians = parsed
            .into_iter()
            .filter(|g| g.opacity >= threshold)
            .collect::<Vec<_>>();
        if gaussians.is_empty() {
            return Err(js_error("No Gaussians remain after the opacity threshold; lower the threshold or check the PLY."));
        }
        Ok(Self {
            gaussians,
            params: ConversionParams {
                resolution: resolution.clamp(8, 256),
                opacity_threshold: threshold,
                sigma_radius: sigma_radius.clamp(0.5, 8.0),
                bounds_quantile: bounds_quantile.clamp(0.0, 0.49),
                ..Default::default()
            },
            field: None,
            mesh: None,
            iso: 0.0,
            input_count,
        })
    }

    /// Creates a session from activated Gaussian data decoded by a compatible
    /// browser format loader. Each row contains mean(3), scale(3), a row-major
    /// rotation matrix(9), opacity(1), and linear RGB(3).
    #[wasm_bindgen(js_name = fromActivated)]
    pub fn from_activated(
        data: &[f32],
        resolution: u32,
        opacity_threshold: f32,
        sigma_radius: f32,
        bounds_quantile: f32,
    ) -> Result<ConversionSession, JsValue> {
        const STRIDE: usize = 19;
        if data.is_empty() || !data.len().is_multiple_of(STRIDE) {
            return Err(js_error("Activated Gaussian buffer has an invalid length"));
        }
        let input_count = data.len() / STRIDE;
        let threshold = opacity_threshold.clamp(0.0, 1.0);
        let mut gaussians = Vec::with_capacity(input_count);
        for row in data.chunks_exact(STRIDE) {
            if row.iter().any(|value| !value.is_finite()) || row[15] < threshold {
                continue;
            }
            gaussians.push(Gaussian {
                mean: Vec3::new(row[0], row[1], row[2]),
                scale: Vec3::new(row[3].max(1.0e-6), row[4].max(1.0e-6), row[5].max(1.0e-6)),
                rotation: row[6..15]
                    .try_into()
                    .map_err(|_| js_error("Invalid rotation matrix"))?,
                opacity: row[15].clamp(0.0, 1.0),
                color: [
                    row[16].clamp(0.0, 1.0),
                    row[17].clamp(0.0, 1.0),
                    row[18].clamp(0.0, 1.0),
                ],
            });
        }
        if gaussians.is_empty() {
            return Err(js_error(
                "No Gaussians remain after decoding and opacity filtering",
            ));
        }
        Ok(Self {
            gaussians,
            params: ConversionParams {
                resolution: resolution.clamp(8, 256),
                opacity_threshold: threshold,
                sigma_radius: sigma_radius.clamp(0.5, 8.0),
                bounds_quantile: bounds_quantile.clamp(0.0, 0.49),
                ..Default::default()
            },
            field: None,
            mesh: None,
            iso: 0.0,
            input_count,
        })
    }

    pub fn metadata(&self) -> String {
        format!("{{\"inputCount\":{},\"retainedCount\":{},\"rejectedOpacity\":{},\"rejectedNonFinite\":0}}", self.input_count, self.gaussians.len(), self.input_count.saturating_sub(self.gaussians.len()))
    }

    pub fn voxelize(&mut self) -> Result<(), JsValue> {
        let field = make_grid(&self.gaussians, &self.params).map_err(js_error)?;
        self.iso = automatic_iso(field.stats);
        self.field = Some(field);
        self.mesh = None;
        Ok(())
    }
    pub fn density_stats(&self) -> Result<String, JsValue> {
        let f = self
            .field
            .as_ref()
            .ok_or_else(|| js_error("Voxelization has not run"))?;
        let histogram = f
            .stats
            .histogram
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        Ok(format!(
            "{{\"min\":{},\"max\":{},\"nonZero\":{},\"histogram\":[{}],\"iso\":{}}}",
            f.stats.min, f.stats.max, f.stats.non_zero, histogram, self.iso
        ))
    }
    pub fn set_iso_threshold(&mut self, iso: f32) -> Result<(), JsValue> {
        if !iso.is_finite() {
            return Err(js_error("Iso threshold must be finite"));
        }
        self.iso = iso;
        self.mesh = None;
        Ok(())
    }
    pub fn extract_mesh(
        &mut self,
        keep_largest: bool,
        min_component_faces: usize,
        smoothing_iterations: u32,
    ) -> Result<(), JsValue> {
        let f = self
            .field
            .as_ref()
            .ok_or_else(|| js_error("Voxelization has not run"))?;
        let raw = extract_mesh(f, &self.gaussians, self.iso, self.params.sigma_radius);
        self.mesh = Some(cleanup_mesh(
            raw,
            keep_largest,
            min_component_faces,
            smoothing_iterations.min(10),
        ));
        Ok(())
    }
    fn mesh_ref(&self) -> Result<&Mesh, JsValue> {
        self.mesh
            .as_ref()
            .ok_or_else(|| js_error("Mesh extraction has not run"))
    }
    pub fn mesh_positions(&self) -> Result<Float32Array, JsValue> {
        Ok(Float32Array::from(self.mesh_ref()?.positions.as_slice()))
    }
    pub fn mesh_normals(&self) -> Result<Float32Array, JsValue> {
        Ok(Float32Array::from(self.mesh_ref()?.normals.as_slice()))
    }
    pub fn mesh_colors(&self) -> Result<Float32Array, JsValue> {
        Ok(Float32Array::from(self.mesh_ref()?.colors.as_slice()))
    }
    pub fn mesh_indices(&self) -> Result<Uint32Array, JsValue> {
        Ok(Uint32Array::from(self.mesh_ref()?.indices.as_slice()))
    }
    pub fn mesh_ply(&self) -> Result<Uint8Array, JsValue> {
        let bytes = mesh_to_ply(self.mesh_ref()?);
        Ok(Uint8Array::from(bytes.as_slice()))
    }
    pub fn vertex_count(&self) -> Result<usize, JsValue> {
        Ok(self.mesh_ref()?.positions.len() / 3)
    }
    pub fn triangle_count(&self) -> Result<usize, JsValue> {
        Ok(self.mesh_ref()?.indices.len() / 3)
    }
    pub fn grid_dimensions(&self) -> Result<Uint32Array, JsValue> {
        let f = self
            .field
            .as_ref()
            .ok_or_else(|| js_error("Voxelization has not run"))?;
        Ok(Uint32Array::from(f.dims.as_slice()))
    }
    pub fn grid_memory_bytes(&self) -> Result<usize, JsValue> {
        let f = self
            .field
            .as_ref()
            .ok_or_else(|| js_error("Voxelization has not run"))?;
        Ok(f.density.len() * std::mem::size_of::<f32>())
    }
    pub fn free(self) {}
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
