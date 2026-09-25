from app.services.ai_service import AIService, ClothingTags


class TestTagParsing:
    """Tests for AI response parsing."""

    def test_parse_valid_json(self):
        """Test parsing valid JSON response."""
        service = AIService()
        response = """
        {
            "type": "shirt",
            "primary_color": "blue",
            "colors": ["blue", "white"],
            "pattern": "striped",
            "material": "cotton",
            "formality": "casual",
            "confidence": 0.85
        }
        """
        tags = service._parse_tags_from_response(response)
        assert tags.type == "shirt"
        assert tags.primary_color == "blue"
        assert tags.colors == ["blue", "white"]
        assert tags.pattern == "striped"
        assert tags.material == "cotton"
        # Confidence is now computed by compute_tag_completeness (not AI self-reported)
        # type(0.25) + primary_color(0.20) + pattern(0.15) + formality(0.15) + material(0.10) + colors(0.05) = 0.90
        assert tags.confidence == 0.9

    def test_parse_json_in_markdown(self):
        """Test parsing JSON wrapped in markdown code block."""
        service = AIService()
        response = """
        Here's the analysis:
        ```json
        {
            "type": "pants",
            "primary_color": "black",
            "colors": ["black"],
            "material": "denim",
            "confidence": 0.9
        }
        ```
        """
        tags = service._parse_tags_from_response(response)
        assert tags.type == "pants"
        assert tags.primary_color == "black"
        assert tags.material == "denim"

    def test_parse_invalid_type(self):
        """Test that invalid type returns unknown."""
        service = AIService()
        response = """
        {
            "type": "invalid_type_xyz",
            "primary_color": "blue"
        }
        """
        tags = service._parse_tags_from_response(response)
        assert tags.type == "unknown"

    def test_parse_invalid_color(self):
        """Test that invalid colors are filtered out."""
        service = AIService()
        response = """
        {
            "type": "shirt",
            "primary_color": "chartreuse",
            "colors": ["blue", "invalid_color", "black"]
        }
        """
        tags = service._parse_tags_from_response(response)
        # Invalid colors should be removed
        assert tags.primary_color is None
        assert "blue" in tags.colors
        assert "black" in tags.colors
        assert "invalid_color" not in tags.colors

    def test_parse_grey_to_gray(self):
        """Test that 'grey' is normalized to 'gray'."""
        service = AIService()
        response = """
        {
            "type": "shirt",
            "primary_color": "grey"
        }
        """
        tags = service._parse_tags_from_response(response)
        assert tags.primary_color == "gray"

    def test_parse_invalid_json(self):
        """Test parsing completely invalid response."""
        service = AIService()
        response = "This is not JSON at all, just some random text."
        tags = service._parse_tags_from_response(response)
        assert tags.type == "unknown"
        assert tags.raw_response == response

    def test_parse_confidence_computed_from_completeness(self):
        """Test that confidence is computed from tag completeness, not AI self-reported value."""
        service = AIService()
        response = """
        {
            "type": "shirt",
            "confidence": 1.5
        }
        """
        tags = service._parse_tags_from_response(response)
        # Confidence is now computed by compute_tag_completeness: type only = 0.25
        assert tags.confidence == 0.25

    def test_parse_valid_formality(self):
        """Test parsing formality levels."""
        service = AIService()
        response = """
        {
            "type": "blazer",
            "formality": "business-casual"
        }
        """
        tags = service._parse_tags_from_response(response)
        assert tags.formality == "business-casual"

    def test_parse_invalid_formality(self):
        """Test that invalid formality is None."""
        service = AIService()
        response = """
        {
            "type": "shirt",
            "formality": "ultra-super-formal"
        }
        """
        tags = service._parse_tags_from_response(response)
        assert tags.formality is None


class TestClothingTags:
    """Tests for ClothingTags model."""

    def test_default_values(self):
        """Test default values for ClothingTags."""
        tags = ClothingTags()
        assert tags.type == "unknown"
        assert tags.colors == []
        assert tags.style == []
        assert tags.confidence == 0.0

    def test_full_construction(self):
        """Test constructing ClothingTags with all fields."""
        tags = ClothingTags(
            type="jacket",
            subtype="blazer",
            primary_color="navy",
            colors=["navy", "white"],
            pattern="solid",
            material="wool",
            style=["formal", "classic"],
            formality="formal",
            season=["fall", "winter"],
            confidence=0.92,
            description="A classic navy blazer",
        )
        assert tags.type == "jacket"
        assert tags.subtype == "blazer"
        assert tags.primary_color == "navy"
        assert len(tags.colors) == 2
        assert tags.confidence == 0.92


class TestTagShapes:
    """A tag list is read as a list whatever shape the model answered with.

    The prompt asks for ``"style": ["casual"]``. Models answer ``"style": "casual"``
    often enough that it has to be a shape we read rather than a bug we log: the
    garment is right and only the JSON is wrong. A bare string used to be iterated
    as a string, so "casual" became ``["c", "a", "s", …]`` and every one of those
    was thrown away as an unknown style — the tag was silently lost, and the same
    bare string reaching the item page as ``tags.style`` took the whole dashboard
    to its error page on ``.map``.
    """

    def test_bare_string_becomes_a_one_element_list(self):
        service = AIService()
        tags = service._parse_tags_from_response(
            '{"type": "shoes", "style": "elegant", "season": "summer", "colors": "black"}'
        )
        assert tags.style == ["elegant"]
        assert tags.season == ["summer"]
        assert tags.colors == ["black"]

    def test_a_bare_string_that_is_not_in_the_vocabulary_is_still_dropped(self):
        service = AIService()
        tags = service._parse_tags_from_response('{"type": "shoes", "style": "pumps"}')
        # Normalising the shape is not the same as widening the vocabulary.
        assert tags.style == []

    def test_a_scalar_wrapped_in_a_list_is_unwrapped(self):
        service = AIService()
        tags = service._parse_tags_from_response(
            '{"type": ["shirt"], "primary_color": ["blue"], "formality": ["casual"],'
            ' "material": ["cotton"], "subtype": ["polo"]}'
        )
        assert tags.type == "shirt"
        assert tags.primary_color == "blue"
        assert tags.formality == "casual"
        assert tags.material == "cotton"
        assert tags.subtype == "polo"

    def test_junk_shapes_lose_the_tag_and_keep_the_garment(self):
        service = AIService()
        tags = service._parse_tags_from_response(
            '{"type": "shirt", "style": {"a": 1}, "season": 3, "colors": [null, 7, "blue"],'
            ' "formality": 12, "primary_color": []}'
        )
        assert tags.type == "shirt"
        assert tags.style == []
        assert tags.season == []
        assert tags.colors == ["blue"]
        assert tags.formality is None
        assert tags.primary_color is None

    def test_an_empty_string_is_not_a_tag(self):
        service = AIService()
        tags = service._parse_tags_from_response('{"type": "shirt", "style": "   ", "subtype": ""}')
        assert tags.style == []
        assert tags.subtype is None
